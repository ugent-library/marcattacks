import { Transform, type TransformCallback } from 'stream';
import type { Record } from "../types/quad.js";
import { parseStream } from "../util/rdf_parse.js";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(opts: any): Promise<Transform> {
    const chunks: any[] = []; // Collect chunks in an array instead of a stream

    return new Transform({
        objectMode: true,

        transform(chunk: any, encoding: string, callback: TransformCallback) {
            logger.debug('chunk received');

            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk)); 
            }
            else if (Buffer.isBuffer(chunk)) {
                chunks.push(chunk);
            }
            else {
                throw new Error(`expecting a string or a Buffer but got a ${typeof chunk}`);
            }

            callback(); 
        },

        async flush(callback: TransformCallback) {
            try {
                logger.debug('flush started');
                const fullBuffer = Buffer.concat(chunks); 
                const { Readable } = await import('stream');

                const finalStream = Readable.from(fullBuffer);

                const hint = opts.hint ? opts.hint : opts.path.href;

                const record: Record = await parseStream(finalStream, hint);

                this.push(record);
                callback();
            } catch (error) {
                logger.error(`RDF parsing error: ${error}`);
                callback(error instanceof Error ? error : new Error(String(error)));
            }
        }
    });
}