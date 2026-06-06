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

        expect(results.length).toBeGreaterThan(0);

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

        // There is at least one datafield (tag, ind1, ind2, code, value, ...).
        const datafield = first.record.find((r: string[]) => r.length > 4 && r[0] !== "LDR");
        expect(datafield).toBeDefined();
    });
});
