import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function run(transformer: any, records: any[]): Promise<any[]> {
    const results: any[] = [];
    await new Promise((resolve, reject) => {
        transformer.on('data', (chunk: any) => results.push(chunk));
        transformer.on('end', resolve);
        transformer.on('error', reject);
        Readable.from(records, { objectMode: true }).pipe(transformer);
    });
    return results;
}

// Write a temp file and return its path; caller is responsible for the dir.
function tmpFile(dir: string, name: string, content: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

describe("transform/jsonata", () => {
    test("no fix expression is an identity pass-through", async () => {
        const plugin = await loadPlugin("jsonata", "transform");
        const mapper = await plugin.createMapper({});

        const record = { record: [["001", " ", " ", "_", "123"]] };
        expect(mapper(record)).toBe(record);
    });

    test("a missing fix file throws", async () => {
        const plugin = await loadPlugin("jsonata", "transform");
        await expect(
            plugin.createMapper({ fix: "/no/such/file.jsonata" })
        ).rejects.toThrow(/no such file/);
    });

    test("registered helpers ($marcmap, $genid) are available in the expression", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-jsonata-"));
        try {
            const file = tmpFile(dir, "map.jsonata", '{ "id": $marcmap("001")[0], "gen": $genid() }');
            const plugin = await loadPlugin("jsonata", "transform");
            const mapper = await plugin.createMapper({ fix: file });

            const out = await mapper({ record: [["001", " ", " ", "_", "990036760400409161"]] });

            expect(out.id).toBe("990036760400409161");
            expect(out.gen).toMatch(/^genid:[0-9a-f-]+$/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("$lookup resolves keys loaded from a 2-column TSV", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-jsonata-"));
        try {
            const lookup = tmpFile(dir, "table.tsv", "key\tval\nfoo\tbar\n");
            const file = tmpFile(dir, "map.jsonata", '$lookup("foo")');
            const plugin = await loadPlugin("jsonata", "transform");
            const mapper = await plugin.createMapper({ fix: file, lookup });

            expect(await mapper({})).toBe("bar");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("$toRDF turns a JSON-LD result into a quads-Record", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-jsonata-"));
        try {
            const file = tmpFile(dir, "map.jsonata", "$toRDF($)");
            const plugin = await loadPlugin("jsonata", "transform");
            const mapper = await plugin.createMapper({ fix: file });

            const out = await mapper({
                "@context": { "ex": "http://example.org/" },
                "@id": "ex:a",
                "ex:b": { "@id": "ex:c" },
            });

            expect(Array.isArray(out.quads)).toBe(true);
            expect(out.quads).toContainEqual({
                subject: { type: "NamedNode", value: "http://example.org/a" },
                predicate: { type: "NamedNode", value: "http://example.org/b" },
                object: { type: "NamedNode", value: "http://example.org/c" },
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("transform() evaluates the expression as it streams records", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-jsonata-"));
        try {
            const file = tmpFile(dir, "map.jsonata", '{ "id": $marcmap("001")[0] }');
            const plugin = await loadPlugin("jsonata", "transform");
            const transformer = await plugin.transform({ fix: file });

            const out = await run(transformer, [
                { record: [["001", " ", " ", "_", "111"]] },
                { record: [["001", " ", " ", "_", "222"]] },
            ]);

            expect(out).toEqual([{ id: "111" }, { id: "222" }]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
