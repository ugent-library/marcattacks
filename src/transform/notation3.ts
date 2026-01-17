import { Transform } from "stream";
import { parseString , writeString } from "../util/rdf_parse.js";
import { type Record, isRecord } from "../types/quad.js";
import * as marc_n3_helpders from "../util/marc_n3_helpers.js";
import fs from "fs";
import log4js from 'log4js';
import eyeling from 'eyeling';

const logger = log4js.getLogger();

export async function transform(param: any) : Promise<Transform> {
    let n3 = null;

    if (param.fix && fs.existsSync(param.fix)) {
        n3 = fs.readFileSync(param.fix,{ encoding: 'utf-8'});
    }
    else {
        logger.warn("no notation3 file provided or found, using empty rules");
    }

    logger.debug(n3);

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const rdfData = await makeRdfData(data);

            if (n3) {
                // Prepare the eyeling input: first write Turtle
                let rdfText = await writeString(rdfData);
                // Inject the n3 rules
                rdfText += "\n\n###RULES\n" + n3;
                // Inject helpers
                rdfText += "\n\n##HELPERS\n" + marc_n3_helpders.code;

                logger.debug(rdfText);

                // Reason
                const rdfOutput = eyeling.reason({ proofComments: false }, rdfText);
                // Turn it back into JSON

                logger.debug(rdfOutput);

                const newData = await parseString(rdfOutput, "data.n3");

                logger.debug(newData);

                callback(null, newData);
            }
            else {
                callback(null, rdfData);
            }
        }
    });
}

async function makeRdfData(data: any) : Promise<Record> {
    // First take a guess if we already have a Record 
    // Stupid guess but sufficient for now
    if (isRecord(data)) {
        return data;
    }

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

    const rdfData = await parseString(JSON.stringify(clone), "data.jsonld");

    return rdfData;
}