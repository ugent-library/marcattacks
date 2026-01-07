import { rdfParser } from "rdf-parse";
import type { Record, Quad } from "../types/quad.js";
import type { Readable } from "stream";

export async function parseString(data:string, path: string) : Promise<Record> {
    const textStream = require('streamify-string')(data);
    return await parseStream(textStream,path);
}

export async function parseStream(data: Readable, path: string) : Promise<Record> {
    return new Promise<Record>( (resolve,reject) => {
        let record : Record = { prefixes: {} , quads: [] };

        rdfParser.parse(data, { path })
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
                reject(error);
            })
            .on('end', () => {
                resolve(record);
            });
    });
}