import { Readable } from 'stream';
import { rdfParser } from "rdf-parse";
import type { Quad, Record } from "../types/quad.js";

import log4js from 'log4js';

const logger = log4js.getLogger();

export function stream2readable(stream: Readable, opts: any) : Readable {
    const readableStream = new Readable({objectMode: true});

    let record : Record = { prefixes: {} , quads: [] };

    rdfParser.parse(stream, { path: opts.path.href })
            .on('data', (quad) => {
                const part : Quad = {
                    "subject": {
                        "type": quad.subject.termType,
                        "value": quad.subject.value
                    },
                    "predicate": {
                        "type": quad.predicate.termType,
                        "value": quad.predicate.value
                    },    
                    "object": {
                        "type": quad.object.termType,
                        "value": quad.object.value
                    }
                };

                if (quad.object.datatype) {
                    part.object.as =  quad.object.datatype.value;
                }

                if (quad.object.language) {
                    part.object.language = quad.object.language;
                }

                record.quads.push(part);
            })
            .on('prefix', (prefix,iri) => {
                record.prefixes[prefix] = iri;  
            })
            .on('error', (error) => {
                logger.error ("Parser error:", error);
            })
            .on('end', () => {
                readableStream.push(record);
                readableStream.push(null);
            });
    return readableStream;
}