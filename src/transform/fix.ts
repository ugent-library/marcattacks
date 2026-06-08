import { Transform } from 'stream';
import fs from 'fs';
import log4js from 'log4js';
import { compileFix, FIXES, REJECT } from 'catmandu-fix-js';
import { toRDF } from '../util/jsonld.js';

const logger = log4js.getLogger();

// Marker key stamped by the `to_rdf` fix below and stripped again in the mapper.
const RDF_MARKER = '@@toRDF';

// `to_rdf` is a synchronous marker fix: it can't call jsonld.toRDF itself
// (that's async, and the compiled Fix chain is synchronous), so it just tags
// the record. The async conversion happens afterwards in the mapper, which is
// already async. Must be used as the *terminal* fix (anything after it would
// run against the marker), and not inside a `do ... end` bind. Registered on
// the shared FIXES table; guarded so importing this module twice is harmless.
if (!FIXES['to_rdf']) {
    // to_rdf()                  -> blank nodes relabelled unique per record
    // to_rdf('<skolem prefix>') -> blank nodes skolemized to IRIs under prefix
    FIXES['to_rdf'] = (args: any[]) => {
        const skolem = args && args[0];
        // Stamp the prefix when given, else `true`; both are truthy markers.
        const mark = typeof skolem === 'string' ? skolem : true;
        return (data: any) => {
            if (data && typeof data === 'object') data[RDF_MARKER] = mark;
            return data;
        };
    };
}

// If a fix tagged the record with `to_rdf`, convert it to a quads-Record now
// (jsonld.toRDF runs here, on the worker thread). Otherwise pass through. A
// string marker is the skolem prefix; `true` means relabel-as-blank-node.
async function finishRDF(out: any): Promise<any> {
    if (out !== REJECT && out && typeof out === 'object' && out[RDF_MARKER]) {
        const { [RDF_MARKER]: mark, ...jsonld } = out;
        return await toRDF(jsonld, typeof mark === 'string' ? { skolem: mark } : {});
    }
    return out;
}

/**
 * Apply a Catmandu Fix script to each record.
 *
 *   marcattacks --map fix --param fix=./my.fix ...
 *
 * `fix` may be a path to a Fix file or an inline Fix script. The script is
 * parsed and compiled once; the compiled chain runs per record.
 *
 * A script may end with `to_rdf()` to emit RDF: the JSON-LD it built is
 * converted to an internal quads-Record (on the worker thread, when running
 * `--workers`), so `--to rdf` only has to serialize.
 */
// Pure record -> record mapper (returns REJECT for dropped records). Shared by
// transform() and the worker pool. Compiled once.
export async function createMapper(opts: { fix?: string }): Promise<(data: any) => any> {
    let src = opts.fix ?? '';
    if (src && fs.existsSync(src)) {
        src = fs.readFileSync(src, { encoding: 'utf-8' });
    }
    const fix = compileFix(src);

    // Fast path: scripts that don't use to_rdf stay a plain synchronous mapper.
    if (!/\bto_rdf\b/.test(src)) return fix;

    return (data: any) => finishRDF(fix(data));
}

export async function transform(opts: { fix?: string }): Promise<Transform> {
    let src = opts.fix ?? '';
    if (src && fs.existsSync(src)) {
        src = fs.readFileSync(src, { encoding: 'utf-8' });
    }
    const fix = compileFix(src);
    const usesRDF = /\bto_rdf\b/.test(src);

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            try {
                const out = usesRDF ? await finishRDF(fix(data)) : fix(data);
                if (out === REJECT) callback();   // rejected record -> drop it
                else callback(null, out);
            } catch (err: any) {
                logger.error('fix error', err.message);
                callback(err);
            }
        }
    });
}
