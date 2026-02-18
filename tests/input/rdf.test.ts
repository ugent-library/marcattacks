import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
@prefix : <http://example.org/>.

:a :b :c.
`.trim();

const json = {
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
};

describe("input/rdf", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("rdf", "input");
        const transformer = await plugin.transform(); 

        const results: any[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data + "\n").pipe(transformer);
        });

        expect(results[0]).toStrictEqual(json);
    });
});