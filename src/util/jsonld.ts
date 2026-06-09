import jsonld from "jsonld";
import { v4 as uuidv4 } from 'uuid';
import type { Record, QVal, Quad } from "../types/quad.js";
import type * as RDF from '@rdfjs/types';
import log4js from 'log4js';

const logger = log4js.getLogger();

// JSON-LD context registry. The shared toRDF() always resolves remote @context
// URLs through this map instead of jsonld's default node loader, so conversion
// never makes an implicit network call. This matters because toRDF runs inside
// the worker threads (called from a JSONata $toRDF or a JS/TS transformer): a
// blocking/hung fetch there would stall a whole batch. Inline @context objects
// need no lookup and work without registration; only remote @context *URLs*
// must be registered up front via registerContext().
const contexts = new Map<string, any>();

// Register a JSON-LD context document under the URL it is referenced by, so
// toRDF() can resolve a remote "@context": "<url>" offline.
export function registerContext(url: string, contextDocument: any): void {
    contexts.set(url, contextDocument);
}

export type DocumentLoader = (url: string) => Promise<{ contextUrl?: string; document: any; documentUrl: string }>;

// The custom loader: registry-backed, never hits the network. An unregistered
// URL is a hard error rather than a silent fetch.
export const documentLoader: DocumentLoader = async (url: string) => {
    const ctx = contexts.get(url);
    if (ctx === undefined) {
        throw new Error(
            `jsonld: refusing to load unregistered context <${url}>; register it with registerContext() (no network access)`
        );
    }
    return { document: ctx, documentUrl: url };
};

// Convert a parsed RDF.Quad into our internal Quad representation. The result is
// a plain object (no class instances), so a Record built from these survives
// structuredClone across the worker -> main thread boundary.
export function toInternalQuad(quad: RDF.Quad): Quad {
    const part: Quad = {
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

    if (quad.object.termType === "Literal") {
        if (quad.object.datatype) {
            part.object.as = quad.object.datatype.value;
        }

        if (quad.object.language) {
            part.object.language = quad.object.language;
        }
    }

    return part;
}

// Rewrite a blank-node term so its label is unique across records. jsonld.toRDF
// restarts its blank-node counter (_:b0, _:b1, ...) on every call, so labels
// from independently-converted records collide once their N-Triples are
// concatenated and re-parsed — distinct nodes get merged. `salt` is one value
// per toRDF() call: constant within the record (intra-record references stay
// consistent) and unique across records (no clash), with no shared state.
//
//   default      : keep it a blank node, prefixed     _:b0 -> _:<salt>b0
//   skolem given : turn it into a stable IRI          _:b0 -> <skolem><salt>b0
//
// Mutates the QVal in place (it is freshly built by toInternalQuad).
function relabelBnode(term: QVal, salt: string, skolem?: string): void {
    if (term.type !== 'BlankNode') return;
    if (skolem !== undefined) {
        term.type = 'NamedNode';
        term.value = `${skolem}${salt}${term.value}`;
    } else {
        term.value = `${salt}${term.value}`;
    }
}

// Convert a JSON-LD object straight into our internal Record using jsonld.toRDF.
// This bypasses the rdf-parse universal wrapper (content negotiation + a fresh
// streaming parser per call), which is ~17x slower than calling jsonld directly.
//
// Exposed as a shared utility so the conversion can run *inside* the transform
// layer (the worker threads) — imported directly by JS/TS transformers, or via
// the JSONata $toRDF() function — instead of single-threaded on the main thread
// in the RDF output stage. The output stage then only has to serialize the
// resulting quads-Record.
//
// Named-graph filtering mirrors parseStream: drop non-default graphs and any
// triple that mentions a graph name as its subject or object.
//
// Blank-node labels are always made unique per record (see relabelBnode); pass
// `skolem` to instead replace blank nodes with stable IRIs under that prefix.
export async function toRDF(
    data: any,
    opts: { documentLoader?: DocumentLoader; skolem?: string } = {},
): Promise<Record> {
    const dataset = await jsonld.toRDF(data, { documentLoader: opts.documentLoader ?? documentLoader }) as RDF.Quad[];

    let record: Record = { prefixes: {}, quads: [] };
    let graphSet = new Set<string>();

    for (const quad of dataset) {
        if (quad.graph.termType !== 'DefaultGraph') {
            graphSet.add(quad.graph.value);
        }
    }

    // One salt per call: unique across records, constant within this one.
    const salt = uuidv4().replace(/-/g, '');

    for (const quad of dataset) {
        if (quad.graph.termType !== 'DefaultGraph') {
            continue;
        }

        if (graphSet.has(quad.subject.value) || graphSet.has(quad.object.value)) {
            continue;
        }

        const part = toInternalQuad(quad);
        // Predicates are always IRIs; only subject/object can be blank nodes.
        relabelBnode(part.subject, salt, opts.skolem);
        relabelBnode(part.object, salt, opts.skolem);
        record.quads.push(part);
    }

    return record;
}
