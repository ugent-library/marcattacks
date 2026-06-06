import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

async function run(transformer: any, records: any[]): Promise<string> {
    const results: string[] = [];
    await new Promise((resolve, reject) => {
        transformer.on('data', (chunk: any) => results.push(chunk.toString()));
        transformer.on('end', resolve);
        transformer.on('error', reject);
        Readable.from(records, { objectMode: true }).pipe(transformer);
    });
    return results.join("");
}

describe("output/csv", () => {
    test("emits a header (alphabetical keys) followed by rows", async () => {
        const plugin = await loadPlugin("csv", "output");
        const transformer = await plugin.transform({});

        const out = await run(transformer, [{ foo: "a", bar: "b" }]);

        expect(out.trim()).toBe("bar,foo\nb,a");
    });

    test("header='no' omits the header row", async () => {
        const plugin = await loadPlugin("csv", "output");
        const transformer = await plugin.transform({ header: "no" });

        const out = await run(transformer, [{ foo: "a", bar: "b" }]);

        expect(out.trim()).toBe("b,a");
    });

    test("casts arrays and objects to ARRAY[n]/HASH[n]", async () => {
        const plugin = await loadPlugin("csv", "output");
        const transformer = await plugin.transform({ header: "no" });

        const out = await run(transformer, [{ arr: [1, 2, 3], obj: { x: 1 }, z: "v" }]);

        expect(out.trim()).toBe("ARRAY[3],HASH[1],v");
    });

    test("skips empty records", async () => {
        const plugin = await loadPlugin("csv", "output");
        const transformer = await plugin.transform({});

        const out = await run(transformer, [{}]);

        expect(out).toBe("");
    });
});
