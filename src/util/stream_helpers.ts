import { Readable, Transform, type TransformCallback } from 'stream';
import log4js from 'log4js';
import { createGunzip } from 'zlib';
import tar from 'tar-stream';

const logger = log4js.getLogger();

/**
 * Limits and skips objects in a Readable stream.
 * @param count Maximum number of objects to emit (optional)
 * @param skip Number of objects to ignore from the start (optional)
 */
export function createCountableSkippedStream(
    count?: number, 
    skip: number = 0
): Transform {
    let skipped = 0;
    let pushed = 0;

    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
      
        if (skipped < skip) {
            skipped++;
            logger.debug(`skipped: ${skipped}`);
            return callback(); // Drop the chunk
        }

        if (count !== undefined && pushed >= count) {
            logger.debug("Limit reached, closing gracefully...");
    
            this.push(null); 
   
            // Hacky but I do not know another way to close all streams and
            // be able to let them flush their content
            setTimeout(() => {
                logger.debug("delay finished, completing transform callback");
                this.destroy();
            },2000);
            
            return;
        }

        this.push(chunk);
        pushed++;

        logger.debug(`pushed: ${pushed}`);
      
        if (count !== undefined && pushed === count) {
            logger.debug("Limit reached, closing gracefully...");
            this.push(null);

             // Hacky but I do not know another way to close all streams and
            // be able to let them flush their content
            setTimeout(() => {
                logger.debug("delay finished, completing transform callback");
                this.destroy();
            },2000);
        }

        callback();
        }
    });
}

/**
 * Does nothing other than counting records
 */
interface VerboseStream extends Transform {
    getCount(): number;
}
export function createVerboseStream() : VerboseStream {
    let recordNum = 0;
    let flushed = false;
    const start = performance.now();
    const transform = new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
            recordNum++;

            logger.trace(`recordNum: ${recordNum}`);
            logger.trace(`highwater mark: ${this.readableHighWaterMark} (read) , ${this.writableHighWaterMark} (write)`);

            if (recordNum % 1000 === 0) {
                const end = performance.now();
                const duration = (end - start)/1000;
                const speed = recordNum/duration;
                logger.debug(`highwater mark: ${this.readableHighWaterMark} (read) , ${this.writableHighWaterMark} (write)`);
                logger.info(`record: ${recordNum} (${speed.toFixed(0)} rec/sec)`);
            }
            callback(null,chunk);
        } ,
        final(callback) {
            logger.debug('final reached');
            if (!flushed) {
                const end = performance.now();
                const duration = (end - start)/1000;
                const speed = recordNum/duration;
                logger.info(`process ${recordNum} records in ${duration.toFixed(2)} seconds (${speed.toFixed(0)} recs/sec)`);
                flushed = true;
                transform.getCount = () =>  {
                    logger.trace(`called getCount -> ${recordNum}`);
                    return recordNum;
                }
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