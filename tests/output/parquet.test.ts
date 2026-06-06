import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function run(transformer: any, records: any[]): Promise<Buffer> {
    const chunks: Buffer[] = [];
    await new Promise((resolve, reject) => {
        transformer.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
        transformer.on('end', resolve);
        transformer.on('error', reject);
        Readable.from(records, { objectMode: true }).pipe(transformer);
    });
    return Buffer.concat(chunks);
}

const schema = { name: { type: "UTF8" }, count: { type: "INT64" } };

// A valid Parquet file starts and ends with the "PAR1" magic bytes.
function isParquet(buf: Buffer): boolean {
    return buf.length > 8 &&
        buf.subarray(0, 4).toString("latin1") === "PAR1" &&
        buf.subarray(-4).toString("latin1") === "PAR1";
}

describe("output/parquet", () => {
    test("writes a Parquet byte stream from an object schema", async () => {
        const plugin = await loadPlugin("parquet", "output");
        const transformer = await plugin.transform({ schema });

        const out = await run(transformer, [
            { name: "foo", count: 1 },
            { name: "bar", count: 2 },
        ]);

        expect(isParquet(out)).toBe(true);
    });

    test("reads the schema from a JSON file path", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-parquet-"));
        const file = path.join(dir, "schema.json");
        fs.writeFileSync(file, JSON.stringify(schema));

        try {
            const plugin = await loadPlugin("parquet", "output");
            const transformer = await plugin.transform({ schema: file });

            const out = await run(transformer, [{ name: "foo", count: 1 }]);
            expect(isParquet(out)).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
