import log4js from 'log4js';
import { loadPlugin } from './plugin-loader.js';
import * as marcUtils from './marcmap.js';
import { sftpLatestFile, sftpReadStream , sftpWriteStream } from './stream/sftpstream.js';
import { httpLatestObject, httpReadStream } from './stream/httpstream.js';
import { Readable } from 'stream';
import { type Transform, type Writable } from 'node:stream';
import { SlowWritable } from './stream/slow-writable.js';
import fs from 'fs';
import { s3LatestObject, s3ReadStream, s3WriteStream } from './stream/s3stream.js';
import { pipeline } from 'node:stream/promises';
import { 
    createCountableSkippedStream, 
    createUntarredStream, 
    createUncompressedStream,
    createVerboseStream, 
    getCleanURL
} from './util/stream_helpers.js';
import { fileLatestFile, fileReadStream } from './stream/filestream.js';
import { createWorkerPool } from './stream/worker-pool.js';
import { availableParallelism } from 'node:os';

const logger = log4js.getLogger();

export class PipelineError extends Error {
    public readonly statusCode: number;
    // True when the failure is just the downstream reader closing the pipe
    // (e.g. `| less` then `q`, or `| head`). The CLI exits quietly in that case.
    public readonly readerDisconnected: boolean;

    constructor(message: string, statusCode: number, readerDisconnected: boolean = false) {
        super(message);
        this.statusCode = statusCode;
        this.readerDisconnected = readerDisconnected;

        Object.setPrototypeOf(this, PipelineError.prototype);

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export async function createInputReadStream(url: URL, opts: any): Promise<{ stream: Readable; resolvedUrl: URL }> {
    logger.info(`input from: ${getCleanURL(url)}`);

    let readableStream: Readable;

    let resolvedUrl : URL = url;

    if (url.protocol.startsWith("http")) {
        resolvedUrl = await httpLatestObject(url);
        readableStream = await httpReadStream(resolvedUrl);
    } 
    else if (url.protocol.startsWith("s3")) {
        // Credentials in the URL take precedence; env vars are only a fallback.
        if (!url.username && process.env.S3_ACCESS_KEY) {
            url.username = process.env.S3_ACCESS_KEY;
        }

        if (!url.password && process.env.S3_SECRET_KEY) {
            url.password = process.env.S3_SECRET_KEY;
        }

        resolvedUrl = await s3LatestObject(url, opts);
        readableStream = await s3ReadStream(resolvedUrl, opts);
    } 
    else if (url.protocol === 'sftp:') {
        // Credentials in the URL take precedence; env vars are only a fallback.
        if (!url.username && process.env.SFTP_USERNAME) {
            url.username = process.env.SFTP_USERNAME;
        }

        if (!url.password && process.env.SFTP_PASSWORD) {
            url.password = process.env.SFTP_PASSWORD;
        }

        resolvedUrl = await sftpLatestFile(url, opts);
        readableStream = await sftpReadStream(resolvedUrl, opts);
    } 
    else if (url.protocol === 'stdin:') {
        readableStream = process.stdin;
    } 
    else {
        resolvedUrl = await fileLatestFile(url);
        readableStream = await fileReadStream(resolvedUrl);
    }

    return { stream: readableStream, resolvedUrl: resolvedUrl};
}

export async function createDecompressionStage(url: URL, opts: { z?: boolean }): Promise<Transform | null> {
    // .tgz is a gzipped tar: it needs gunzip here AND untar in the next stage.
    if (opts.z || url.pathname.endsWith(".gz") || url.pathname.endsWith(".tgz")) {
        logger.info(`unzipping input`);
        return createUncompressedStream();
    }
    return null;
}

export async function createUntarStage(url: URL, opts: { tar?: boolean }): Promise<Transform | null> {
    // Escape the dots so this matches real .tar/.tar.* suffixes, not e.g.
    // "guitar.xml" or "nectar.json".
    if (opts.tar || url.pathname.match(/\.tar(\.\w+)?$/) || url.pathname.endsWith(".tgz")) {
        logger.info(`untarring input`);
        return await createUntarredStream();
    }
    return null;
}

export async function createInputTransformStage(url: URL, opts: {from: string, param?: any}): Promise<Transform> {
    if (!opts.from) {
        console.error(`Need --from`);
        process.exit(1);
    }

    logger.info(`activating from: ${opts.from}`);
    const mod = await loadPlugin(opts.from, 'input');
    return await mod.transform(Object.assign({ path: url }, opts.param), { utils: marcUtils });
}

export async function createCountSkipStage(opts: {count?: number, skip?: number}): Promise<Transform | null> {
    if (opts.count || opts.skip) {
        if (opts.count) {
            logger.info(`counting: ${opts.count}`);
        }
        if (opts.skip) {
            logger.info(`skipping: ${opts.skip}`);
        }
        return createCountableSkippedStream(opts.count, opts.skip);
    }
    return null;
}

// --workers is "auto" by default = CPU cores - 1, leaving a core for the main
// thread (parse / I/O / serialize / reorder). An explicit number is honored
// as-is; "1" (or auto resolving to 1 on a single core) disables threading.
export function isAutoWorkers(workersOpt: unknown): boolean {
    return workersOpt === undefined || workersOpt === 'auto';
}
export function resolveWorkerCount(workersOpt: unknown, cores: number = availableParallelism()): number {
    return isAutoWorkers(workersOpt)
        ? Math.max(1, cores - 1)
        : (parseInt(String(workersOpt), 10) || 1);
}

// Decide whether the map runs on worker threads:
//  - the resolved worker count must be > 1, and
//  - the map must be parallelizable (exposes createMapper), and
//  - in `auto` mode the map must also opt in (autoParallel) — so cheap maps
//    like `fix` stay single-threaded by default; an EXPLICIT --workers N
//    threads any parallelizable map regardless of autoParallel.
export function shouldParallelize(
    workersOpt: unknown,
    caps: { parallelizable: boolean; autoParallel: boolean },
    cores: number = availableParallelism(),
): boolean {
    if (resolveWorkerCount(workersOpt, cores) <= 1) return false;
    if (!caps.parallelizable) return false;
    return !isAutoWorkers(workersOpt) || caps.autoParallel;
}

export async function createMapTransformStage(opts: any): Promise<Transform | null> {
    if (opts.map) {
        const mod = await loadPlugin(opts.map, 'transform');
        // A map plugin can declare that, for the given params, it would pass
        // records through unchanged (e.g. the default `jsonata` map with no
        // --param fix=). Skip the stage entirely so we neither insert a no-op
        // transform nor spin up a worker pool to shuttle records through an
        // identity function. `--map` defaults to `jsonata`, so without this a
        // plain `--from xml --to json` would needlessly start a full worker pool.
        if (typeof mod.isPassthrough === 'function' && mod.isPassthrough(opts.param)) {
            return null;
        }

        logger.info(`activating mapper: ${opts.map}`);

        const parallelizable = typeof mod.createMapper === 'function';
        const autoParallel = mod.autoParallel === true;
        const fanOut = mod.fanOut === true;
        const workers = resolveWorkerCount(opts.workers);
        if (shouldParallelize(opts.workers, { parallelizable, autoParallel })) {
            return createWorkerPool({ map: opts.map, param: opts.param, workers, fanOut });
        }
        // Only nag when the user EXPLICITLY asked for threads on a map that
        // can't use them; auto stays quiet (and cheap parallelizable maps just
        // run serial under auto by design).
        if (workers > 1 && !parallelizable && !isAutoWorkers(opts.workers)) {
            logger.warn(`--workers ${workers} ignored: map '${opts.map}' is not parallelizable`);
        }
        return await mod.transform(opts.param, { utils: marcUtils });
    }
    return null;
}

export async function createOutputWriteStream(opts: any): Promise<Writable> {
    if (isWritableStream(opts.out)) {
        return opts.out;
    }
    else if (opts.out) {
        logger.info(`output to: ${opts.out}`);
    }
    else {
        logger.info(`output to: stdout`);
    }

    if (opts.out === '@slow') {
        return new SlowWritable({ delayMs: 100 });
    }
    
    if (opts.out === '@errors') {
        return new SlowWritable({ simulateErrorEveryN: 2 });
    }
    
    if (opts.out) {
        if (/^sftp:/.test(opts.out)) {
            const url = new URL(opts.out);
            
            // Credentials in the URL take precedence; env vars are only a fallback.
            if (!url.username && process.env.SFTP_USERNAME) {
                url.username = process.env.SFTP_USERNAME;
            }

            if (!url.password && process.env.SFTP_PASSWORD) {
                url.password = process.env.SFTP_PASSWORD;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await sftpWriteStream(url, opts);
        }
        else if (/^s3s?:/.test(opts.out)) {
            const url = new URL(opts.out);

            // Credentials in the URL take precedence; env vars are only a fallback.
            if (!url.username && process.env.S3_ACCESS_KEY) {
                url.username = process.env.S3_ACCESS_KEY;
            }

            if (!url.password && process.env.S3_SECRET_KEY) {
                url.password = process.env.S3_SECRET_KEY;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await s3WriteStream(url, { acl: opts.acl });
        }
        else if (/^file:/.test(opts.out)) {
            const url = new URL(opts.out);

            return fs.createWriteStream(url.pathname, { encoding: 'utf-8' });
        }
        else {
            return fs.createWriteStream(opts.out, { encoding: 'utf-8' });
        }
    }
    
    return process.stdout;
}

export async function createOutputTransformStage(opts: any): Promise<Transform | null> {
    if (opts.to) {
        logger.info(`activating to: ${opts.to}`);
        const mod = await loadPlugin(opts.to, 'output');
        return await mod.transform(opts.param, { utils: marcUtils });
    }
    return null;
}

export async function attack(url: URL, opts: any): Promise<number> {
    let result = 0;
    try {
        const { stream: readableStream, resolvedUrl: inputFile } = await createInputReadStream(url, opts);
        const stages: (Readable | Transform | Writable)[] = [readableStream];

        // Add decompression stage if needed
        const decompressionStage = await createDecompressionStage(inputFile, opts);
        if (decompressionStage) stages.push(decompressionStage);

        // Add untar stage if needed
        const untarStage = await createUntarStage(inputFile, opts);
        if (untarStage) stages.push(untarStage);

        // Add input transform stage (required)
        const inputTransform = await createInputTransformStage(inputFile, opts);
        stages.push(inputTransform);

        // Add count/skip stage if needed
        const countSkipStage = await createCountSkipStage(opts);
        if (countSkipStage) stages.push(countSkipStage);

        // Add verbose stream (always included)
        const verboseStream = createVerboseStream(opts.logEvery);
        stages.push(verboseStream);

        // Add map transform stage if needed
        const mapStage = await createMapTransformStage(opts);
        if (mapStage) stages.push(mapStage);

        // Add output transform stage if needed
        const outputTransform = await createOutputTransformStage(opts);
        if (outputTransform) {
            stages.push(outputTransform);
            
            // Add output write stream
            const outStream = await createOutputWriteStream(opts);
            stages.push(outStream);

            // Let the count limiter wait for THIS sink to finish flushing
            // before it tears the pipeline down, instead of a fixed timer.
            if (countSkipStage && 'setFlushTarget' in countSkipStage) {
                (countSkipStage as any).setFlushTarget(outStream);
            }

            try {
                await pipeline(stages);
                result = verboseStream.getCount();
                logger.info("pipeline finished cleanly");
            } catch (err: any) {
                result = 'getCount' in verboseStream ? verboseStream.getCount() : 0;

                if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    logger.info("stream closed by limiter.");
                }
                else if (isReaderClosedPipe(err)) {
                    // The downstream reader closed the output pipe before we were
                    // done writing — e.g. `| less` then `q`, or `| head`. This is
                    // a normal, expected shutdown, not a failure. Throw a "quiet"
                    // error so the CLI still tears the pipeline (and any worker
                    // threads) down via process.exit, but WITHOUT printing a
                    // colorized stack to the tty — which would otherwise race a
                    // pager's terminal-restore sequence and wedge the terminal
                    // (requiring `reset`).
                    logger.info("output pipe closed by reader");
                    throw new PipelineError(err.message, 0, true);
                }
                else {
                    logger.debug(err);
                    logger.error("pipeline closed prematurely");
                    throw new PipelineError(err.message, 3);
                }
            }
        }
        else {
            // No output sink (opts.to falsy): the input read stream, any
            // decompression/untar stages and — crucially — a spawned worker
            // pool were already created. Without a pipeline() they would never
            // run nor be torn down, leaking file handles and keeping the event
            // loop alive on the worker threads. Destroy them.
            logger.warn("no output transform configured; tearing down unused stages");
            for (const stage of stages) {
                try { (stage as any).destroy?.(); } catch { /* best effort */ }
            }
        }
    } catch (e) {
        if (e instanceof PipelineError) {
            throw e;
        } else {
            throw e;
        }
    }
    return result;
}

// EPIPE/ECONNRESET surfaced anywhere in the error chain means the reader on the
// other end of our output went away. Check the wrapped cause too, since pipeline
// errors can nest the original.
function isReaderClosedPipe(err: any): boolean {
    for (let e = err; e; e = e.cause) {
        if (e.code === 'EPIPE' || e.code === 'ECONNRESET' || e.code === 'ERR_STREAM_DESTROYED') return true;
        if (typeof e.message === 'string' && /\b(EPIPE|ECONNRESET)\b/.test(e.message)) return true;
    }
    return false;
}

function isWritableStream(obj: any): boolean {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.write === 'function' &&
        typeof obj.end === 'function' &&
        obj.writable !== false
    );
}