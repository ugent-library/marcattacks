import { Transform } from "stream";
import { type Record, isRecord } from "../types/quad.js";
import { parseString } from "../util/rdf_parse.js";
import { marcmap } from "../marcmap.js";

export interface MarcInRDFOptions {
    parse?: "jsonld" | "quads" | "text:field" | "text:full" | "text:flat";
}

// An experimental processor that does a literal translation of
// alephseq into something RDF-ish. No full data model. A quick
// and dirty literal translation of sequential. Other tools in
// the chain could map this proto-RDF into a full model.
export async function transform(opts: MarcInRDFOptions = {}) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const rdfData = await makeRdfData(data, opts);
            callback(null, rdfData);
        }
    });
}

async function makeRdfData(data: any, opts: MarcInRDFOptions = {} ) : Promise<Record> {
    const parse = opts.parse ? opts.parse : "jsonld";

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

    if (parse === "quads") {
        return await parseString(JSON.stringify(clone), "data.jsonld");
    }
    else if (parse === "text:field") {
        const record : any = { 
            "text" : serializeFieldRecord(clone)
        };
        return record;
    }
    else if (parse === "text:full") {
        const record : any = { 
            "text" : serializeFullRecord(clone)
        };
        return record;
    }
    else if (parse === "text:flat") {
        const record : any = {
            "text" : serializeFlatRecord(clone)
        };
        return record;
    }
    else {
        return clone;
    }
}

function serializeFlatRecord(record: any) : string {
    const id = record['@id'];
    const ex = "http://example.org/ns#";
    const fields = record['record'];

    const fieldNodes : string[] = [];

    for (let i = 0 ; i < fields.length ; i++) {
        const field = fields[i];
        const props : string[] = [];

        if (field[0] !== undefined) props.push(`<${ex}tag> ${serializeValue(field[0])}`);
        if (field[1] !== undefined) props.push(`<${ex}ind1> ${serializeValue(field[1])}`);
        if (field[2] !== undefined) props.push(`<${ex}ind2> ${serializeValue(field[2])}`);

        const subNodes : string[] = [];
        for (let j = 3 ; j < field.length ; j += 2) {
            const code  = field[j];
            const value = field[j+1];
            if (code === undefined || value === undefined) continue;
            subNodes.push(`[ <${ex}code> ${serializeValue(code)}; <${ex}value> ${serializeValue(value)} ]`);
        }
        props.push(`<${ex}sub> ( ${subNodes.join(" ")} )`);

        fieldNodes.push(`[ ${props.join("; ")} ]`);
    }

    let result = `<${id}> a <${ex}Record>`;
    if (fieldNodes.length > 0) {
        result += `;\n    <${ex}field> ${fieldNodes.join(",\n    ")}`;
    }
    result += ".";

    return result;
}

function serializeFieldRecord(record: any) : string {
    const id = record ['@id'];
    const ex = "http://example.org/ns#";
    let result = `<${id}> a <${ex}Record>.\n`;
    const fields = record['record'];

    for (let i = 0 ; i < fields.length ; i++) {
        const tag  = fields[i][0];
        const rest = fields[i].splice(1);
        result += `<${id}> <${ex}f${tag}> ${serializeArray(rest)}.\n`;
    }

    return result.trim();
}

function serializeFullRecord(record: any) : string {
    const id = record ['@id'];
    const ex = "http://example.org/ns#";
    let result = `<${id}> a <${ex}Record>.\n`;

    result += `<${id}> <${ex}record> ${serializeArray(record['record'])}.\n`;

    return result.trim();
}


function serializeArray(array: any[]) {
    const result : string = "(" + array.map(x => {
        if (Array.isArray(x)) {
            return serializeArray(x);
        }
        else {
            return serializeValue(x);
        }
    }).join(" ") + ")";
    return result;
}

function serializeValue(value: any) {
    const result = "\"" +
        value.replaceAll(/\\/g,"\\\\").replaceAll(/"/g,"\\\"")
             .replaceAll(/\n/g,"\\n").replaceAll(/\r/g,"\\r").replaceAll(/\t/g,"\\t") +
        "\"";
    return result;
}