import { Readable, Transform, type TransformCallback } from 'stream';
import log4js from 'log4js';

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
    
            setImmediate(() => {
                this.destroy();
            });
            
            return;
        }

        this.push(chunk);
        pushed++;

        logger.debug(`pushed: ${pushed}`);
      
        if (count !== undefined && pushed === count) {
            logger.debug("Limit reached, closing gracefully...");
            this.push(null);
            setImmediate(() => {
                this.destroy();
            });
        }

        callback();
        }
    });
}

/**
 * Does nothing other than counting records
 */
export function createVerboseStream() : Transform {
    let recordNum = 0;
    let flushed = false;
    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
            recordNum++;

            if (recordNum % 1000 === 0) {
                logger.info(`record: ${recordNum}`);
            }
            callback(null,chunk);
        } ,
        flush(callback) {
            if (!flushed) {
                logger.info(`process ${recordNum} records`);
                flushed = true;
            }
            callback();
        } ,
        destroy(err,callback) {
            if (!flushed) {
                logger.info(`process ${recordNum} records`);
                flushed = true;
            }
            callback(err);
        }
    });
}
