// A Transform that parallelizes a per-record map across worker threads while
// preserving record order. Batches incoming records, dispatches batches to a
// pool of workers, and re-orders the results before pushing them downstream.
//
// In  (objectMode): record objects
// Out (objectMode): mapped record objects, in the original order
//                   (records the map rejected are dropped)
import { Transform, type TransformCallback } from 'stream';
import { Worker } from 'node:worker_threads';
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface WorkerPoolOpts {
    map: string;
    param: any;
    workers: number;
    batchSize?: number;
}

export function createWorkerPool(opts: WorkerPoolOpts): Transform {
    const N = Math.max(1, opts.workers);
    const BATCH = opts.batchSize ?? 64;
    const CAP = N * 2;                       // max batches in flight (backpressure)
    const workerUrl = new URL('../worker.js', import.meta.url);

    const workers: Worker[] = [];
    const idle: Worker[] = [];
    const queue: { seq: number; batch: any[] }[] = [];
    const reorder = new Map<number, any[]>();

    let nextDispatch = 0;
    let nextEmit = 0;
    let inflight = 0;
    let curBatch: any[] = [];
    let resumeCb: TransformCallback | null = null;
    let endCb: TransformCallback | null = null;
    let failed: Error | null = null;

    const stream = new Transform({
        objectMode: true,
        transform(rec: any, _enc, cb: TransformCallback) {
            if (failed) { cb(failed); return; }
            curBatch.push(rec);
            if (curBatch.length >= BATCH) { enqueue(curBatch); curBatch = []; }
            if (inflight < CAP) cb();
            else resumeCb = cb;              // hold the callback => upstream backpressure
        },
        flush(cb: TransformCallback) {
            if (failed) { cb(failed); return; }
            if (curBatch.length) { enqueue(curBatch); curBatch = []; }
            if (drained()) finish(cb);
            else endCb = cb;
        }
    });

    function drained(): boolean {
        return nextEmit === nextDispatch && queue.length === 0;
    }

    function enqueue(batch: any[]): void {
        queue.push({ seq: nextDispatch++, batch });
        dispatch();
    }

    function dispatch(): void {
        while (queue.length && idle.length) {
            const w = idle.pop()!;
            const job = queue.shift()!;
            inflight++;
            w.postMessage(job);
        }
    }

    function onResult(w: Worker, msg: any): void {
        if (msg.error) { fail(new Error(msg.error)); return; }
        reorder.set(msg.seq, msg.mapped);
        idle.push(w);
        inflight--;

        // emit any now-contiguous results in order
        while (reorder.has(nextEmit)) {
            const mapped = reorder.get(nextEmit)!;
            reorder.delete(nextEmit);
            nextEmit++;
            for (const m of mapped) if (m !== null) stream.push(m);
        }

        dispatch();

        if (resumeCb && inflight < CAP) { const c = resumeCb; resumeCb = null; c(); }
        if (endCb && drained()) { const c = endCb; endCb = null; finish(c); }
    }

    function fail(err: Error): void {
        if (failed) return;
        failed = err;
        for (const w of workers) w.terminate();
        if (resumeCb) { const c = resumeCb; resumeCb = null; c(err); }
        else if (endCb) { const c = endCb; endCb = null; c(err); }
        else stream.destroy(err);
    }

    function finish(cb: TransformCallback): void {
        Promise.all(workers.map((w) => w.terminate())).then(() => cb()).catch(() => cb());
    }

    for (let i = 0; i < N; i++) {
        const w = new Worker(workerUrl, { workerData: { map: opts.map, param: opts.param } });
        workers.push(w);
        w.on('message', (msg: any) => {
            if (msg && msg.ready) { idle.push(w); dispatch(); }
            else onResult(w, msg);
        });
        w.on('error', (err) => fail(err));
    }

    logger.info(`map running on ${N} worker threads (batch ${BATCH})`);
    return stream;
}
