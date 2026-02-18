import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

// header order is alphabetical because the transformer sorts keys
const data = `
bar\tfoo
b\ta
`.trim();

const json = {
  "foo": "a",
  "bar": "b"
};

describe("output/tsv", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("tsv", "output");
        // pass in an empty options object to avoid undefined lookups
        const transformer = await plugin.transform({}); 

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from([json], { objectMode: true }).pipe(transformer);
        });

        const output = results.join("");

        // ignore final newline when comparing
        expect(output.trim()).toStrictEqual(data);
    });
});