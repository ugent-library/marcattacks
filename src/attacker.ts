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

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;

        Object.setPrototypeOf(this, PipelineError.prototype);

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export async function createInputReadStream(url: URL, opts: any): Promise<{ stream: Readable; resolvedUrl: URL }> {
    logger.info(`using: ${getCleanURL(url)}`);

    let readableStream: Readable;

    let resolvedUrl : URL = url;

    if (url.protocol.startsWith("http")) {
        resolvedUrl = await httpLatestObject(url);
        readableStream = await httpReadStream(resolvedUrl);
    } 
    else if (url.protocol.startsWith("s3")) {
        if (process.env.S3_ACCESS_KEY) {
            url.username = process.env.S3_ACCESS_KEY;
        }

        if (process.env.S3_SECRET_KEY) {
            url.password = process.env.S3_SECRET_KEY;
        }

        resolvedUrl = await s3LatestObject(url, opts);
        readableStream = await s3ReadStream(resolvedUrl, opts);
    } 
    else if (url.protocol === 'sftp:') {
        if (process.env.SFTP_USERNAME) {
            url.username = process.env.SFTP_USERNAME;
        }

        if (process.env.SFTP_PASSWORD) {
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
    if (opts.z || url.pathname.endsWith(".gz")) {
        return createUncompressedStream();
    }
    return null;
}

export async function createUntarStage(url: URL, opts: { tar?: boolean }): Promise<Transform | null> {
    if (opts.tar || url.pathname.match(/.tar(.\w+$)?$/) || url.pathname.endsWith(".tgz")) {
        return await createUntarredStream();
    }
    return null;
}

export async function createInputTransformStage(url: URL, opts: {from: string, param?: any}): Promise<Transform> {
    if (!opts.from) {
        console.error(`Need --from`);
        process.exit(1);
    }

    const mod = await loadPlugin(opts.from, 'input');
    return await mod.transform(Object.assign({ path: url }, opts.param), { utils: marcUtils });
}

export async function createCountSkipStage(opts: {count?: number, skip?: number}): Promise<Transform | null> {
    if (opts.count || opts.skip) {
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
        const parallelizable = typeof mod.createMapper === 'function';
        const autoParallel = mod.autoParallel === true;
        const workers = resolveWorkerCount(opts.workers);
        if (shouldParallelize(opts.workers, { parallelizable, autoParallel })) {
            return createWorkerPool({ map: opts.map, param: opts.param, workers });
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
    
    if (opts.out === '@slow') {
        return new SlowWritable({ delayMs: 100 });
    }
    
    if (opts.out === '@errors') {
        return new SlowWritable({ simulateErrorEveryN: 2 });
    }
    
    if (opts.out) {
        if (/^sftp:/.test(opts.out)) {
            const url = new URL(opts.out);
            
            if (process.env.SFTP_USERNAME) {
                url.username = process.env.SFTP_USERNAME;
            }

            if (process.env.SFTP_PASSWORD) {
                url.password = process.env.SFTP_PASSWORD;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await sftpWriteStream(url, opts);
        }
        else if (/^s3s?:/.test(opts.out)) {
            const url = new URL(opts.out);

            if (process.env.S3_ACCESS_KEY) {
                url.username = process.env.S3_ACCESS_KEY;
            }

            if (process.env.S3_SECRET_KEY) {
                url.password = process.env.S3_SECRET_KEY;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await s3WriteStream(url, {});
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
            
            try {
                await pipeline(stages);
                result = verboseStream.getCount();
                logger.info("pipeline finished cleanly");
            } catch (err: any) {
                result = 'getCount' in verboseStream ? verboseStream.getCount() : 0;

                if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    logger.info("stream closed by limiter.");
                } 
                else {
                    logger.debug(err);
                    logger.error("pipeline closed prematurely");
                    throw new PipelineError(err.message, 3);
                }
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

function isWritableStream(obj: any): boolean {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.write === 'function' &&
        typeof obj.end === 'function' &&
        obj.writable !== false
    );
}