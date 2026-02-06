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
            chunks.push(chunk); 
            callback(); 
        },

        async flush(callback: TransformCallback) {
            try {
                logger.debug('flush started');
                const fullBuffer = Buffer.concat(chunks); 
                
                const { Readable } = await import('stream');
                const finalStream = Readable.from(fullBuffer);

                const record: Record = await parseStream(finalStream, opts.path.href);

                this.push(record);
                callback();
            } catch (error) {
                logger.error(`RDF parsing error: ${error}`);
                callback(error instanceof Error ? error : new Error(String(error)));
            }
        }
    });
}