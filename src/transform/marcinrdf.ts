import { Transform } from "stream";
import { type Record, isRecord } from "../types/quad.js";
import { parseString } from "../util/rdf_parse.js";
import { marcmap } from "../marcmap.js";

// An experimental processor that does a literal translation of
// alephseq into something JSON-LD-ish
export async function transform(opts: { parse: string }) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const rdfData = await makeRdfData(data, opts);
            callback(null, rdfData);
        }
    });
}

async function makeRdfData(data: any, opts: { parse: string }) : Promise<Record> {
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

    if (opts.parse && opts.parse === 'true') {
        return await parseString(JSON.stringify(clone), "data.jsonld");
    }
    else {
        return clone;
    }
}