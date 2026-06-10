import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import { ParquetReader } from "@dsnp/parquetjs";
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

    test("default output (page index disabled) spans row groups and reads back every row", async () => {
        // With pageIndex disabled by default the writer keeps less footer
        // metadata in memory; the file must still be a valid, fully-readable
        // parquet file. Force several row groups with a small rowGroupSize.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-parquet-"));
        const file = path.join(dir, "rows.parquet");
        try {
            const plugin = await loadPlugin("parquet", "output");
            const transformer = await plugin.transform({ schema, rowGroupSize: 4 });

            const records = Array.from({ length: 25 }, (_, i) => ({ name: `n${i}`, count: i }));
            const out = await run(transformer, records);
            fs.writeFileSync(file, out);
            expect(isParquet(out)).toBe(true);

            const reader = await ParquetReader.openFile(file);
            expect(Number(reader.getRowCount())).toBe(25);
            const cursor = reader.getCursor();
            const read: any[] = [];
            for (let r = await cursor.next(); r; r = await cursor.next()) read.push(r);
            await reader.close();
            expect(read.map((r) => r.name)).toEqual(records.map((r) => r.name));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("rowGroupSize and pageIndex params are honoured", async () => {
        const plugin = await loadPlugin("parquet", "output");
        // pageIndex as a string "true" (as it would arrive from --param) re-enables it
        const t1 = await plugin.transform({ schema, pageIndex: "true", rowGroupSize: "2" });
        expect((t1 as any).writer.rowGroupSize).toBe(2);
        expect((t1 as any).writer.envelopeWriter.pageIndex).toBe(true);

        // default: page index off
        const t2 = await plugin.transform({ schema });
        expect((t2 as any).writer.envelopeWriter.pageIndex).toBe(false);
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
