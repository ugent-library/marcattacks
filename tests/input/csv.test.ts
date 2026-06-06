import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

async function run(transformer: any, input: string): Promise<any[]> {
    const results: any[] = [];
    await new Promise((resolve, reject) => {
        transformer.on('data', (chunk: any) => results.push(chunk));
        transformer.on('end', resolve);
        transformer.on('error', reject);
        Readable.from(input).pipe(transformer);
    });
    return results;
}

describe("input/csv", () => {
    test("uses the first row as header keys", async () => {
        const plugin = await loadPlugin("csv", "input");
        const transformer = await plugin.transform();

        const out = await run(transformer, "foo,bar\na,b\nc,d\n");

        expect(out).toEqual([
            { foo: "a", bar: "b" },
            { foo: "c", bar: "d" },
        ]);
    });

    test("honours a custom delimiter", async () => {
        const plugin = await loadPlugin("csv", "input");
        const transformer = await plugin.transform({ delimiter: ";" });

        const out = await run(transformer, "foo;bar\na;b\n");

        expect(out).toEqual([{ foo: "a", bar: "b" }]);
    });
});
