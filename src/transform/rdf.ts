import { Transform } from "stream";
import { marcmap } from '../marcmap.js';

const prefixes = {
    this: 'https://lib.ugent.be/record',
    schema: 'https://schema.org/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
};

export default function transform(_opts: any) {
    return new Transform({
        objectMode: true,
        transform(data: any, encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) return;

            data['prefixes'] = prefixes;
            data['quads'] = rec2quads(rec);
            callback(null,data);
        }
    });
}

function rec2quads(rec: string[][]) {
    let quads : any[] = [];

    let id = marcmap(rec,"001",{});

    if (!id) return;

    quads.push({
        subject: { value: `${prefixes.this}${id}` },
        predicate: { value: `${prefixes.rdf}type`},
        object: { value: `${prefixes.schema}CreativeWork`}
    });

    return quads;
}   