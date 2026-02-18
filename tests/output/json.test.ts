import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
[{
    "record": [
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
}]
`.trim();

const json = {
    "record": [
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
};

describe("output/json", () => {
    test("transform converts output correctly", async () => {
        const plugin = await loadPlugin("json", "output");
        const transformer = await plugin.transform(); 

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from([json], { objectMode: true }).pipe(transformer);
        });

        const output = results.join(" ");
    
        expect(JSON.parse(output)).toStrictEqual(JSON.parse(data));
    });
});