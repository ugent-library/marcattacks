import { rdfParser } from "rdf-parse";
import type { Record, Quad } from "../types/quad.js";
import type { Readable, Writable } from "stream";
import streamify from "streamify-string";
import N3 from 'n3';

const { DataFactory } = N3;
const { namedNode, literal, blankNode } = DataFactory;

export async function parseString(data:string, path: string) : Promise<Record> {
    const textStream = streamify(data);
    return await parseStream(textStream,path);
}

export async function parseStream(readable: Readable, path: string) : Promise<Record> {
    return new Promise<Record>( (resolve,reject) => {
        let record : Record = { prefixes: {} , quads: [] };
        let graphSet = new Set<string>();

        rdfParser.parse(readable, { path })
            .on('data', (quad) => {

                // Ignore named graphs
                if (quad.graph.termType === 'DefaultGraph') {
                    // We are ok
                }
                else {
                    graphSet.add(quad.graph.value);
                    return;
                }

                // Also ignore triples mentioning the graphSet
                if (graphSet.has(quad.subject.value) || graphSet.has(quad.object.value)) {
                    return;
                }

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

export async function writeString(data: Record, format?:string, writer?: N3.Writer) : Promise<string> {
    let internalWriter = false;

    if (!writer) {
        let prefixes = data['prefixes'];
        writer = new N3.Writer({ end: false, prefixes , format });
        internalWriter = true;
    }

    return new Promise<string>( (resolve, reject) => {
        let quads : any[] = data['quads'];

        if (!quads) resolve("");

        for (let i = 0 ; i < quads.length ; i++) {
            if (quads[i].subject && quads[i].predicate && quads[i].object) {
                // ok
            }
            else continue;
                
            let subject   = { type: 'NamedNode', value: '', ...quads[i].subject};
            let predicate = { type: 'NamedNode', value: '', ...quads[i].predicate};
            let object    = { type: 'NamedNode', value: '', ...quads[i].object};

            let subjectValue = 
                subject.type === 'NamedNode' ? namedNode(subject.value) 
                : subject.type === 'BlankNode' ? blankNode(subject.value)
                : namedNode(subject.value);
                
            let predicateValue = 
                predicate.type === 'NamedNode' ? namedNode(predicate.value) 
                : namedNode(predicate.value);
                
            let objectValue = 
                object.type === 'NamedNode' ? namedNode(object.value) 
                : object.type === 'BlankNode' ? blankNode(object.value)
                : object.type === 'Literal' && object.language ? literal(object.value, object.language)
                : object.type === 'Literal' && object.as ? literal(object.value, namedNode(object.as))
                : object.type === 'Literal' ? literal(object.value)
                : namedNode(object.value);

            writer.addQuad(
                subjectValue,
                predicateValue,
                objectValue
            );
        }

        if (internalWriter) {
            writer.end( (error,result) => {
                if (error)
                    reject(error);
                else
                    resolve(result);
            });
        }
        else {
            resolve("");
        }
    });
}