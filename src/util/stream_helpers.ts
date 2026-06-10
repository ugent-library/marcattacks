import { Readable, Transform, type Writable, type TransformCallback } from 'stream';
import log4js from 'log4js';
import { createGunzip } from 'zlib';
import tar from 'tar-stream';

const logger = log4js.getLogger();

/**
 * A count/skip limiter that can be told which downstream sink to wait for
 * before it tears the pipeline down.
 */
export interface CountableStream extends Transform {
    /**
     * Register the final writable sink. When the record limit is reached the
     * limiter ends the stream (push(null)) and then waits for this sink to
     * actually finish flushing before destroying the pipeline — instead of
     * guessing with a fixed timer. Safe to call with process.stdout.
     */
    setFlushTarget(target: Writable): void;
}

/**
 * How long to wait for a flush target that never emits 'finish'.
 * process.stdout/stderr are never end()ed by pipeline(), so 'finish' will
 * not fire for them; this fallback keeps the pipeline from hanging.
 */
const FLUSH_FALLBACK_MS = 2000;

/**
 * Limits and skips objects in a Readable stream.
 * @param count Maximum number of objects to emit (optional)
 * @param skip Number of objects to ignore from the start (optional)
 */
export function createCountableSkippedStream(
    count?: number,
    skip: number = 0
): CountableStream {
    let skipped = 0;
    let pushed = 0;
    let limitReached = false;
    let flushTarget: Writable | undefined;

    const stream = new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
            if (skipped < skip) {
                skipped++;
                logger.debug(`skipped: ${skipped}`);
                return callback(); // Drop the chunk
            }

            // Already past the limit: end the readable side and park upstream
            // (no callback) so we stop reading the source. Mirrors the original
            // control flow — the repeated push(null) matters for propagating EOF
            // cleanly through a downstream worker pool.
            if (count !== undefined && pushed >= count) {
                this.push(null);
                closeGracefully();
                return;
            }

            this.push(chunk);
            pushed++;

            logger.debug(`pushed: ${pushed}`);

            // Hitting the limit: end the readable side so downstream flushes.
            // We still call callback() below (the boundary chunk) so 'end'
            // propagates; the *next* chunk parks the source via the guard above.
            if (count !== undefined && pushed === count) {
                closeGracefully();
            }

            callback();
        }
    }) as CountableStream;

    stream.setFlushTarget = (target: Writable) => { flushTarget = target; };

    /**
     * Reached the record limit: end the downstream chain so the sink flushes,
     * then destroy the pipeline once the sink has actually finished (rather
     * than after a fixed delay). The destroy surfaces as ERR_STREAM_PREMATURE_
     * CLOSE upstream, which the caller treats as a clean limiter stop.
     */
    function closeGracefully() {
        if (limitReached) return;
        limitReached = true;

        logger.debug("Limit reached, closing gracefully...");
        stream.push(null); // EOF -> downstream transforms flush -> sink finishes

        let torn = false;
        let fallback: ReturnType<typeof setTimeout> | undefined;
        const teardown = (why: string) => {
            if (torn) return;
            torn = true;
            // Clear the orphaned fallback timer; a pending timer would keep the
            // event loop alive (and delay process exit) long after teardown.
            if (fallback) clearTimeout(fallback);
            logger.debug(`sink ${why}, tearing down pipeline`);
            stream.destroy();
        };

        // stdout/stderr are never end()ed by pipeline(), so they never emit
        // 'finish'/'close'. Don't wait on events that won't come — fall straight
        // through to the original fixed-timer teardown (this also keeps the
        // default jsonata worker-pool case working, which the timer delay covers).
        // Checking flushTarget inline (rather than via a helper bool) lets TS
        // narrow it to a defined Writable for the real-sink branch below.
        if (!flushTarget
            || flushTarget === process.stdout
            || flushTarget === process.stderr) {
            setTimeout(() => teardown('timer (stdout/no target)'), FLUSH_FALLBACK_MS);
            return;
        }

        if (flushTarget.writableFinished) {
            teardown('already finished');
            return;
        }

        // Real sink (S3, sftp, file): tear down the moment it has flushed,
        // rather than after a fixed delay. The fallback timer only fires if the
        // sink never finishes for some reason, so we don't hang.
        flushTarget.once('finish', () => teardown('finished'));
        flushTarget.once('close', () => teardown('closed'));
        flushTarget.once('error', () => teardown('errored'));
        fallback = setTimeout(() => teardown('flush fallback timer'), FLUSH_FALLBACK_MS);
    }

    return stream;
}

/**
 * Does nothing other than counting records
 */
export interface VerboseStream extends Transform {
    getCount(): number;
}

export function createVerboseStream(logEvery: number = 1000) : VerboseStream {
    let recordNum = 0;
    const start = performance.now();
    const transform = new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
            recordNum++;

            logger.trace(`recordNum: ${recordNum}`);
            logger.trace(`highwater mark: ${this.readableHighWaterMark} (read) , ${this.writableHighWaterMark} (write)`);

            if (recordNum % logEvery === 0) {
                const end = performance.now();
                // elapsed is milliseconds; divide by 1000 for rec/sec. Dividing
                // by logEvery only happened to be correct at the default 1000.
                const duration = (end - start)/1000;
                const speed = recordNum/duration;
                logger.debug(`highwater mark: ${this.readableHighWaterMark} (read) , ${this.writableHighWaterMark} (write)`);
                logger.info(`record: ${recordNum} (${speed.toFixed(0)} rec/sec)`);
            }
            callback(null,chunk);
        } ,
        flush (callback: TransformCallback) {
            logger.debug('final reached');
            const end = performance.now();
            const duration = (end - start)/1000;
            const speed = recordNum/duration;
            logger.info(`process ${recordNum} records in ${duration.toFixed(2)} seconds (${speed.toFixed(0)} recs/sec)`);
            transform.getCount = () =>  {
                logger.trace(`called getCount -> ${recordNum}`);
                return recordNum;
            }
            callback();
        }
    }) as VerboseStream;

    return transform;
}

/**
 * Creates an uncompressed stream
 */
export function createUncompressedStream() : Transform {
    return createGunzip();
}

/**
 * Creates an untarred stream
 */
export async function createUntarredStream(): Promise<Transform> {
    const extract = tar.extract();

    const transformStream = new Transform({
        objectMode: true,

        transform(chunk: any, encoding: string, callback: TransformCallback) {
            // Ensure chunk is a Buffer (tar-stream expects binary data)
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
            
            // Don't pass callback directly - let it be called after write completes
            const writeSuccessful = extract.write(buffer);
            
            if (!writeSuccessful) {
                // Backpressure handling
                extract.once('drain', callback);
            } else {
                callback();
            }
        },
        flush(callback: TransformCallback) {
            extract.end();
            extract.once('finish', callback);
        }
    });

    extract.on('entry', (header, stream, next) => {
        logger.info(`extracting ${header.name} from tar stream`);
        
        const chunks: Buffer[] = [];

        stream.on('data', (chunk) => {
            logger.debug(`received chunk of size ${chunk.length}`);
            chunks.push(chunk);
        });
        
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            logger.debug(`end of entry ${header.name}, total size: ${buffer.length}`);
            transformStream.push(buffer.toString('utf-8'));
            next();
        });

        stream.on('error', (err) => {
            logger.error(`error reading entry ${header.name}:`, err);
            next(err);
        });

        stream.resume(); 
    });

    extract.on('finish', () => {
        logger.debug('All tar entries processed');
        transformStream.push(null); // Signal end of stream
    });

    extract.on('error', (err) => {
        logger.error('tar extract error:', err);
        transformStream.destroy(err);
    });

    return transformStream;
}

/**
 * Return a URL censored passwords
 * @param url 
 * @returns URL
 */
export function getCleanURL(url: URL): URL {
    const tempUrl = new URL(url.href);
    tempUrl.username = '***';
    tempUrl.password = '***';
    return tempUrl;
}

/***
 * Return a URL without passwords
 * @param url
 * @returns URL
 */
export function getStrippedURL(url: URL): URL {
    const tempUrl = new URL(url.href);
    tempUrl.username = '';
    tempUrl.password = '';
    return tempUrl;
}