import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import { parseString } from "../../dist/util/rdf_parse.js"; 

const data = `
@prefix : <http://example.org/>.

:a :b :c.
:a :b "foo"^^:bar.
:a :b "foo"@id.
`.trim();

const json = [
{
  "quads": [{
    "subject": {
        "type": "NamedNode",
        "value": "http://example.org/a"
    },
    "predicate": {
        "type": "NamedNode",
        "value": "http://example.org/b"
    },
    "object": {
        "type": "NamedNode",
        "value": "http://example.org/c"
    }
  }]
},
{
  "quads": [{
    "subject": {
        "type": "NamedNode",
        "value": "http://example.org/a"
    },
    "predicate": {
        "type": "NamedNode",
        "value": "http://example.org/b"
    },
    "object": {
        "type": "Literal",
        "value": "foo",
        "as": "http://example.org/bar"
    }
  }]
},
{
  "quads": [{
    "subject": {
        "type": "NamedNode",
        "value": "http://example.org/a"
    },
    "predicate": {
        "type": "NamedNode",
        "value": "http://example.org/b"
    },
    "object": {
        "type": "Literal",
        "value": "foo",
        "as": "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
        "language": "id"
    }
  }]
}
];

describe("output/rdf", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("rdf", "output");
        const transformer = await plugin.transform(); 

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: string) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(json, { objectMode: true }).pipe(transformer);
        });

        const output = results.join("");

        const recordA = await parseString(data, "local.ttl");
        const recordB = await parseString(output, "local.ttl");

        let recordWithoutPrefixesA,recordWithoutPrefixesB;

        {
            const {prefixes, ...recordWithoutPrefixesA } = recordA;
        }
        {
            const {prefixes, ...recordWithoutPrefixesB } = recordB;
        }

        expect(recordWithoutPrefixesA).toStrictEqual(recordWithoutPrefixesB);
    });
});