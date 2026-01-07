import { Readable, Writable } from 'stream';
import { writeString, parseString } from '../util/rdf_parse.js';
import { isRecord } from '../types/quad.js';
import N3 from 'n3';

import log4js from 'log4js';

const logger = log4js.getLogger();

export async function readable2writable(readable: Readable, writable: Writable): Promise<void> {
    let writer: N3.Writer | undefined;
    let counter = 0;

    logger.debug(`start`);

    try {
        for await (const data of readable) {
            counter++;

            if (isRecord(data)) {
                logger.debug(`[${counter}] is a Record`);
                const prefixes = data['prefixes'];

                if (!writer) {
                    writer = new N3.Writer(writable, { end: false, prefixes });
                }
                await writeString(data, undefined, writer);
            } 
            else if (Object.hasOwn(data, "@context")) {
                logger.debug(`[${counter}] is a JSON-LD`);
                const dataNew = await parseString(JSON.stringify(data), "data.jsonld");

                if (!writer) {
                    writer = new N3.Writer(writable, { end: false });
                }
                await writeString(dataNew, undefined, writer);
            } 
            else {
                logger.warn(`[${counter}] is not a Record or a JSON-LD`);
                // Consider if you need to initialize a writer here if one doesn't exist
            }
        }

        logger.debug(`end ${counter}`);
        if (writer) {
            writer.end();
        } else {
            logger.error(`no writer defined?!`);
        }
    } catch (err) {
        logger.error("Stream processing error:", err);
    } finally {
        writable.end();
    }
}