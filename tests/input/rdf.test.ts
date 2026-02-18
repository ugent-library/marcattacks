import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import type { Quad } from '../../dist/types/quad.js'

const data = `
@prefix : <http://example.org/>.

:a :b :c.
:a :b "foo"^^:bar.
:a :b "foo"@id.
`.trim();

const expected = [
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

describe("input/rdf", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("rdf", "input");
        const transformer = await plugin.transform(); 

        const results: Quad[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: Quad) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data + "\n").pipe(transformer);
        });

        expect(results).toStrictEqual(expected);
    });
});