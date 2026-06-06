import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

describe("output/null", () => {
    test("consumes records and produces no output", async () => {
        const plugin = await loadPlugin("null", "output");
        const transformer = await plugin.transform({});

        const results: any[] = [];
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from([{ a: 1 }, { b: 2 }], { objectMode: true }).pipe(transformer);
        });

        expect(results).toHaveLength(0);
    });
});
