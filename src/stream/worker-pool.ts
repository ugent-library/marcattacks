// A Transform that parallelizes a per-record map across worker threads while
// preserving record order. Batches incoming records, dispatches batches to a
// pool of workers, re-orders the results by sequence number, and pushes them
// downstream in order.
//
// In  (objectMode): record objects
// Out (objectMode): mapped record objects, in the original order
//                   (records the map rejected are dropped)
//
// Hardening over the first prototype:
//  - worker count is clamped to the available parallelism;
//  - real downstream backpressure: results are held in an out-queue and only
//    pushed while push() accepts them; dispatch/accept pause when the output
//    is backed up and resume on _read (so a slow sink can't grow memory);
//  - a per-batch timeout fails the pipeline instead of hanging if a worker
//    dies silently.
import { Transform, type TransformCallback } from 'stream';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface WorkerPoolOpts {
    map: string;
    param: any;
    workers: number;
    batchSize?: number;
    timeoutMs?: number;
}

export function createWorkerPool(opts: WorkerPoolOpts): Transform {
    const maxN = Math.max(1, availableParallelism());
    const N = Math.min(Math.max(1, Math.floor(opts.workers) || 1), maxN);
    if (N < opts.workers) logger.warn(`--workers ${opts.workers} clamped to ${N} (available parallelism)`);
    const BATCH = opts.batchSize ?? 64;
    const CAP = N * 2;                 // max batches in flight
    const OUT_CAP = CAP * BATCH;       // max records buffered awaiting downstream
    const TIMEOUT = opts.timeoutMs ?? 120_000;
    const workerUrl = new URL('../worker.js', import.meta.url);

    const workers: Worker[] = [];
    const idle: Worker[] = [];
    const timers = new Map<Worker, NodeJS.Timeout>();
    const queue: { seq: number; batch: any[] }[] = [];
    const reorder = new Map<number, any[]>();
    const outQueue: any[] = [];        // mapped records ready to push, in order

    let nextDispatch = 0;
    let nextEmit = 0;
    let inflight = 0;
    let curBatch: any[] = [];
    let acceptCb: TransformCallback | null = null;   // held _transform callback
    let endCb: TransformCallback | null = null;
    let failed: Error | null = null;
    let closing = false;                              // we are terminating workers on purpose

    const stream = new Transform({
        objectMode: true,
        transform(rec: any, _enc, cb: TransformCallback) {
            if (failed) { cb(failed); return; }
            curBatch.push(rec);
            if (curBatch.length >= BATCH) { enqueue(curBatch); curBatch = []; }
            if (canAccept()) cb();
            else acceptCb = cb;          // pause upstream until there's room
        },
        flush(cb: TransformCallback) {
            if (failed) { cb(failed); return; }
            if (curBatch.length) { enqueue(curBatch); curBatch = []; }
            if (done()) finish(cb);
            else endCb = cb;
        }
    });

    // Resume producing when the downstream consumer asks for more.
    const origRead = (stream as any)._read.bind(stream);
    (stream as any)._read = (size: number) => { pump(); origRead(size); };

    function canAccept(): boolean {
        return inflight < CAP && outQueue.length < OUT_CAP;
    }
    function done(): boolean {
        return nextEmit === nextDispatch && queue.length === 0 && outQueue.length === 0;
    }

    function enqueue(batch: any[]): void {
        queue.push({ seq: nextDispatch++, batch });
        dispatch();
    }

    const dbg = () => logger.isDebugEnabled();

    function dispatch(): void {
        // don't start new work while the output is backed up
        if (dbg() && queue.length && (!idle.length || outQueue.length >= OUT_CAP)) {
            logger.debug(`backpressure: ${queue.length} batches queued, idle=${idle.length}, outQueue=${outQueue.length}/${OUT_CAP}`);
        }
        while (queue.length && idle.length && outQueue.length < OUT_CAP) {
            const w = idle.pop()!;
            const job = queue.shift()!;
            inflight++;
            timers.set(w, setTimeout(() => fail(new Error(`worker timed out after ${TIMEOUT}ms (batch ${job.seq})`)), TIMEOUT));
            w.postMessage(job);
            if (dbg()) logger.debug(`dispatch batch ${job.seq} (${job.batch.length} recs) -> worker; inflight=${inflight}`);
        }
    }

    // push as many ready records as the downstream will take
    function pump(): void {
        const before = outQueue.length;
        // push() returns false when the consumer is backed up, but the record
        // it was given HAS been accepted — so always shift it off the queue,
        // then stop pushing. (Leaving it on the queue re-pushes the same record
        // on the next _read, looping forever once a real sink applies
        // backpressure; the null sink never does, which masked this.)
        while (outQueue.length) {
            const ok = stream.push(outQueue.shift());
            if (!ok) break;
        }
        if (dbg() && outQueue.length > 0 && outQueue.length === before) {
            logger.debug(`downstream full, holding ${outQueue.length} records`);
        }
        dispatch();
        if (acceptCb && canAccept()) { const c = acceptCb; acceptCb = null; c(); }
        if (endCb && done()) { const c = endCb; endCb = null; finish(c); }
    }

    function onResult(w: Worker, msg: any): void {
        const t = timers.get(w);
        if (t) { clearTimeout(t); timers.delete(w); }
        if (msg.error) { logger.error(`worker error on batch ${msg.seq}: ${msg.error}`); fail(new Error(msg.error)); return; }
        reorder.set(msg.seq, msg.mapped);
        idle.push(w);
        inflight--;
        if (dbg()) logger.debug(`result batch ${msg.seq} (${msg.mapped.length} mapped); inflight=${inflight}, reorderBuf=${reorder.size}, wantNext=${nextEmit}`);
        // move now-contiguous results into the out-queue (don't push yet)
        while (reorder.has(nextEmit)) {
            const mapped = reorder.get(nextEmit)!;
            reorder.delete(nextEmit);
            nextEmit++;
            for (const m of mapped) if (m !== null) outQueue.push(m);
        }
        pump();
    }

    function fail(err: Error): void {
        if (failed) return;
        failed = err;
        closing = true;
        logger.error(`worker pool failing: ${err.message} (terminating ${workers.length} workers)`);
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        for (const w of workers) w.terminate();
        if (acceptCb) { const c = acceptCb; acceptCb = null; c(err); }
        else if (endCb) { const c = endCb; endCb = null; c(err); }
        else stream.destroy(err);
    }

    function finish(cb: TransformCallback): void {
        closing = true;
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        logger.debug(`map complete: ${nextEmit} batches; terminating ${workers.length} workers`);
        Promise.all(workers.map((w) => w.terminate())).then(() => cb()).catch(() => cb());
    }

    for (let i = 0; i < N; i++) {
        // stdout/stderr: true keeps each worker's stdio OUT of the parent's
        // process.stdout/stderr. By default Node pipes every worker's stdio
        // through to the parent, attaching close/error/finish listeners to the
        // parent WriteStream per worker -> a MaxListenersExceededWarning once
        // --workers crosses ~8. Workers here are pure compute and report results
        // and errors over postMessage, so they never need the parent's console.
        const w = new Worker(workerUrl, {
            workerData: { map: opts.map, param: opts.param },
            stdout: true,
            stderr: true,
        });
        workers.push(w);
        w.on('message', (msg: any) => {
            if (msg && msg.ready) { idle.push(w); dispatch(); if (dbg()) logger.debug(`worker ${idle.length}/${N} ready`); }
            else onResult(w, msg);
        });
        w.on('error', (err) => { logger.error(`worker thread crashed: ${err.message}`); fail(err); });
        w.on('exit', (code) => { if (code !== 0 && !failed && !closing) fail(new Error(`worker exited unexpectedly (code ${code})`)); });
    }

    logger.info(`map running on ${N} worker threads (batch ${BATCH}, in-flight cap ${CAP}, timeout ${TIMEOUT}ms)`);
    (stream as any).isWorkerPool = true;   // lets callers/tests tell a threaded map stage from a serial one
    return stream;
}
