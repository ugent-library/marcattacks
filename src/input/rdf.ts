import { Readable } from 'stream';
import { rdfParser } from "rdf-parse";
import type { Record } from "../types/quad.js";
import { parseStream } from "../util/rdf_parse.js";

import log4js from 'log4js';

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable, opts: any) : Promise<Readable> {
    const readableStream = new Readable({
        objectMode: true ,
        destroy() {
            stream.destroy();
        }
    });

    const record : Record = await parseStream(stream, opts.path.href);

    readableStream.push(record);
    readableStream.push(null);

    return readableStream;
}