import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
990036760400409161 FMT   L BK
990036760400409161 001   L 990036760400409161
990036760400409161 035   L $$a(RUG01)003676040
990036760400409161 1001  L $$aCassiers, Paul,$$d1965-2025
`.trim();

const json = {
    "record": [
        ["FMT", " ", " ", "_", "BK"],
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
};

describe("output/alephseq", () => {
    test("transform converts output correctly", async () => {
        const plugin = await loadPlugin("alephseq", "output");
        const transformer = await plugin.transform(); 

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from([json], { objectMode: true }).pipe(transformer);
        });

        expect(results[0]).toStrictEqual(data + "\n");
    });
});