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

describe("output/multipart", () => {
    test("writes a header, boundary-separated parts and a closing delimiter", async () => {
        const plugin = await loadPlugin("multipart", "output");
        const transformer = await plugin.transform({});

        const out = await run(transformer, [{ a: "1", b: "2" }, { a: "3", b: "4" }]);

        expect(out).toContain('Content-Type: multipart/mixed; boundary="marcattacks"');
        expect(out).toContain("1 2");
        expect(out).toContain("--marcattacks\n");
        expect(out).toContain("3 4");
        expect(out.trimEnd().endsWith("--marcattacks--")).toBe(true);
    });

    test("casts arrays and objects in the part body", async () => {
        const plugin = await loadPlugin("multipart", "output");
        const transformer = await plugin.transform({});

        const out = await run(transformer, [{ arr: [1, 2, 3], h: { x: 1, y: 2 } }]);

        expect(out).toContain("ARRAY[3] HASH[2]");
    });

    test("noEndDelimiter='true' omits the closing delimiter", async () => {
        const plugin = await loadPlugin("multipart", "output");
        const transformer = await plugin.transform({ noEndDelimiter: "true" });

        const out = await run(transformer, [{ a: "1" }]);

        expect(out.includes("--marcattacks--")).toBe(false);
    });
});
