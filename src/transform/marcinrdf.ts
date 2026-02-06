import { Transform } from "stream";
import { type Record, isRecord } from "../types/quad.js";
import { parseString } from "../util/rdf_parse.js";
import { marcmap } from "../marcmap.js";

export async function transform(_param: any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const rdfData = await makeRdfData(data);
            callback(null, rdfData);
        }
    });
}

async function makeRdfData(data: any) : Promise<Record> {
    // First take a guess if we already have a Record 
    // Stupid guess but sufficient for now
    if (isRecord(data)) {
        return data;
    }

    const id = marcmap(data['record'],"001",{})[0];

    const clone = structuredClone(data);

    // Parse the input data as RDF
    clone['@context'] = {
        "@vocab": "http://example.org/ns#",
        "ex": "http://example.org/ns#",
        "record": {
            "@id": "ex:record",
            "@container": "@list"
        }
    };

    clone['@id'] = `http://example.org/record/${id}` ;
    clone['@type'] = 'ex:Record';

    const rdfData = await parseString(JSON.stringify(clone), "data.jsonld");

    return rdfData;
}