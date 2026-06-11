import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
foo\tbar
a\tb
`.trim();

const json = {
  "foo": "a",
  "bar": "b"
};

describe("input/tsv", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("tsv", "input");
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

    test("preserves multi-byte UTF-8 characters split across chunk boundaries", async () => {
        const plugin = await loadPlugin("tsv", "input");
        const transformer = await plugin.transform();

        // header + one data row; split between the two bytes of é (c3 a9)
        const text = Buffer.from("name\tnote\ncafé\trésumé\n", "utf8");
        const splitAt = text.indexOf(0xa9);

        const results: any[] = [];
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            transformer.write(text.subarray(0, splitAt));
            transformer.write(text.subarray(splitAt));
            transformer.end();
        });

        expect(results).toStrictEqual([{ name: "café", note: "résumé" }]);
    });

    test("emits a final row with no trailing newline", async () => {
        const plugin = await loadPlugin("tsv", "input");
        const transformer = await plugin.transform();

        const results: any[] = [];
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from("foo\tbar\na\tb").pipe(transformer);
        });

        expect(results).toStrictEqual([{ foo: "a", bar: "b" }]);
    });
});