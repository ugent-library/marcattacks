import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
{ "record": [ ["001", " ", " ", "_", "990036760400409161"], ["035", " ", " ", "a", "(RUG01)003676040"], ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"] ] }
`.trim();

const json = {
    "record": [
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
};

describe("input/jsonl", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("jsonl", "input");
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