import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../data/npr01.mrc");

describe("input/marc (ISO2709)", () => {
    test("parses ISO2709 records into the [tag, ind1, ind2, ...] row format", async () => {
        const plugin = await loadPlugin("marc", "input");
        const transformer = await plugin.transform({});

        const results: any[] = [];
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            fs.createReadStream(fixture).pipe(transformer);
        });

        // The fixture holds 135 records (one per 0x1D record separator). The
        // parser drains its queue asynchronously, so every record must survive
        // the flush — a weaker "> 0" check would miss trailing-record loss.
        const separators = fs.readFileSync(fixture).filter((b) => b === 0x1d).length;
        expect(separators).toBe(135);
        expect(results.length).toBe(separators);

        const first = results[0];
        expect(Array.isArray(first.record)).toBe(true);

        // The leader is always emitted first as an LDR row.
        const ldr = first.record[0];
        expect(ldr[0]).toBe("LDR");
        expect(typeof ldr[4]).toBe("string");

        // Every row begins with a tag string.
        for (const row of first.record) {
            expect(typeof row[0]).toBe("string");
        }

        // Control fields (00x) carry their value at index 4 behind the '_'
        // code placeholder, same as LDR — not at index 3 (which would put the
        // value in the subfield-code slot and lose it downstream).
        const control = first.record.find((r: string[]) => /^00/.test(r[0]!));
        expect(control).toBeDefined();
        expect(control[3]).toBe("_");
        expect(typeof control[4]).toBe("string");
        expect(control[4]!.length).toBeGreaterThan(0);

        // There is at least one datafield (tag, ind1, ind2, code, value, ...).
        const datafield = first.record.find((r: string[]) => r.length > 4 && r[0] !== "LDR");
        expect(datafield).toBeDefined();
    });
});
