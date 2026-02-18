import { Transform, type TransformCallback, PassThrough } from 'stream';
import type { Record } from "../types/quad.js";
import { parseStreamAsParts } from "../util/rdf_parse.js";
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface InputRDFOptions {
    hint?: string;
    path?: URL;
}

export async function transform(opts: InputRDFOptions = {}): Promise<Transform> {
    let inputStream: PassThrough | null = null;
    let partsStream: any = null;

    return new Transform({
        objectMode: true,

        transform(chunk: any, encoding: string, callback: TransformCallback) {
            logger.debug('chunk received');

            try {
                // Initialize the input stream on first chunk
                if (!inputStream) {
                    inputStream = new PassThrough();
                    const hint = opts.hint ? 
                                    opts.hint : 
                                    opts.path?.href ?
                                    opts.path.href : 
                                    "local.ttl";
                    
                    partsStream = parseStreamAsParts(inputStream, hint);

                    partsStream.on('data', (quad: any) => {
                        this.push({ quads: [quad] });
                    });

                    partsStream.on('error', (error: any) => {
                        logger.error(`RDF parsing error: ${error}`);
                        this.destroy(error instanceof Error ? error : new Error(String(error)));
                    });
                }

                // Pass chunks directly to the input stream without buffering
                if (typeof chunk === 'string') {
                    inputStream.write(Buffer.from(chunk));
                }
                else if (Buffer.isBuffer(chunk)) {
                    inputStream.write(chunk);
                }
                else {
                    throw new Error(`expecting a string or a Buffer but got a ${typeof chunk}`);
                }

                callback();
            } catch (error) {
                logger.error(`RDF parsing error: ${error}`);
                callback(error instanceof Error ? error : new Error(String(error)));
            }
        },

        flush(callback: TransformCallback) {
            logger.debug('flush started');
            
            if (inputStream) {
                inputStream.end();
                partsStream.on('end', () => {
                    callback();
                });
            } else {
                callback();
            }
        }
    });
}