import { Transform } from 'stream';
import { writeString, parseString } from '../util/rdf_parse.js';
import { isRecord } from '../types/quad.js';
import N3 from 'n3';

import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_param:any): Promise<Transform> {
    let writer: N3.Writer | undefined;
    let counter = 0;

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            counter++;

            if (isRecord(data)) {
                logger.trace(`[${counter}] is a Record`);
                if (!writer) {
                    writer = new N3.Writer({ 
                        end: false, 
                        prefixes: data['prefixes'] || {},
                        write: (chunk: string) => this.push(chunk)
                    });
                }
                await writeString(data, undefined, writer);
            } 
            else if (Object.hasOwn(data, "@context")) {
                logger.trace(`[${counter}] is a JSON-LD`);
                const dataNew = await parseString(JSON.stringify(data), "data.jsonld");

                if (!writer) {
                    writer = new N3.Writer({ 
                        end: false, 
                        prefixes: data['prefixes'] || {},
                        write: (chunk: string) => this.push(chunk)
                    });
                }

                await writeString(dataNew, undefined, writer);
            } 
            else {
                logger.warn(`[${counter}] is not a Record or a JSON-LD`);
            }

            callback();
        },
        flush(callback) {
            logger.debug('flush reached');
            writer?.end();
            callback();
        }
    });
}