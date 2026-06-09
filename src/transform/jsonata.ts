import Stream, { Transform } from "stream";
import jsonata from "jsonata";
import fs from "fs";
import { marcmap, marctag, marcind, marcsubfields } from '../marcmap.js';
import { toRDF } from '../util/jsonld.js';
import { parseStream } from '../util/tsv_parse.js';
import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';

const logger = log4js.getLogger();

// JSONata is heavy/interpreted, so the `--workers auto` default should spread it
// across threads. (Cheap maps like `fix` are parallelizable too but do NOT set
// this, so auto leaves them single-threaded; an explicit --workers N still
// threads any parallelizable map.)
export const autoParallel = true;

// With no `fix` the query is `$` (identity), so the mapper is a pure
// pass-through — there is nothing to map. 
export function isPassthrough(opts?: { fix?: string }): boolean {
    return !opts?.fix;
}

// Build a pure record -> record(Promise) mapper. Shared by the in-process
// transform() and by the worker pool (so the heavy evaluate() can run on
// worker threads). Expression + helper functions are compiled once.
export async function createMapper(opts: { fix: string, lookup: string }) : Promise<(data: any) => any> {
    let lookup : Record<string,string> = {};

    if (opts.lookup) {
        lookup = await loadLookup(opts.lookup);
    }

    // Resolve the query once, up front, instead of on every record.
    let query : string;
    if (opts.fix) {
        if (fs.existsSync(opts.fix)) {
            query = fs.readFileSync(opts.fix,{ encoding: 'utf-8'});
        }
        else {
            throw Error(`no such file ${opts.fix}`);
        }
    }
    else {
        query = '$';
    }
    logger.debug(query);

    // The identity expression is a pure pass-through: skip jsonata entirely.
    if (query.trim() === '$') {
        return (data: any) => data;
    }

    // Compile the expression and register helper functions ONCE. The helpers
    // read the record currently being processed via `current`; each evaluate
    // is awaited before the next, so this is safe.
    let current: any;
    const expression = jsonata(query);
    expression.registerFunction('marcmap', (code: string) => marcmap(current['record'], code, {}));
    expression.registerFunction('marctag', (row: string[]) => marctag(row));
    expression.registerFunction('marcind', (row: string[]) => marcind(row));
    expression.registerFunction('marcsubfields', (row: string[], regex: string) => marcsubfields(row, new RegExp(regex)));
    expression.registerFunction('marcrecord', () => current['record']);
    expression.registerFunction('asmarc', (data: string[][]) => ({ "record": data }));
    expression.registerFunction('genid', () => genid());
    expression.registerFunction('lookup', (key) => lookup[key]);
    // Convert a JSON-LD object to an internal quads-Record. Async: JSONata
    // awaits the returned promise. Ending a fix with $toRDF(...) moves the
    // JSON-LD -> RDF conversion onto the worker threads (where this mapper
    // runs), so the single-threaded RDF output stage only has to serialize.
    // $toRDF(data [, skolem]): convert JSON-LD to a quads-Record. With a skolem
    // prefix, blank nodes become stable IRIs under it; without, they stay blank
    // but are relabelled unique per record.
    expression.registerFunction('toRDF', (data: any, skolem?: string) =>
        toRDF(data, skolem !== undefined ? { skolem } : {}));

    return async (data: any) => { current = data; return expression.evaluate(data); };
}

export async function transform(opts: { fix: string, lookup: string }) : Promise<Transform> {
    const mapper = await createMapper(opts);

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding: BufferEncoding, callback: Stream.TransformCallback) {
            try {
                callback(null, await mapper(data));
            }
            catch (err: any) {
                logger.info(err);
                callback(err as Error);
            }
        }
    });
}

function genid() : string {
    return `genid:${uuidv4()}`;
}

async function loadLookup(path: string) : Promise<Record<string,string>> {
    let lookup : Record<string, string> = {};

    const records = await parseStream(fs.createReadStream(path));

    for (const row of records) {
        const keys = Object.keys(row).sort();
        if (keys && keys.length == 2 && keys[0] && keys[1]) {
            const A = row[keys[0]];
            const B = row[keys[1]];
            if (A && B) {
                lookup[A] = B;
            }
        }
    }

    return lookup;
}