import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
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

describe("transform/fix", () => {
    test("createMapper applies an inline Fix script per record", async () => {
        const plugin = await loadPlugin("fix", "transform");
        const mapper = await plugin.createMapper({ fix: 'add_field("job","fixer")' });

        expect(mapper({})).toEqual({ job: "fixer" });
        expect(mapper({ a: 1 })).toEqual({ a: 1, job: "fixer" });
    });

    test("transform() applies the Fix script as it streams records", async () => {
        const plugin = await loadPlugin("fix", "transform");
        const transformer = await plugin.transform({ fix: 'add_field("job","fixer")' });

        const out = await run(transformer, [{ a: 1 }, { b: 2 }]);

        expect(out).toEqual([
            { a: 1, job: "fixer" },
            { b: 2, job: "fixer" },
        ]);
    });

    test("reject() drops the record from the stream", async () => {
        const plugin = await loadPlugin("fix", "transform");
        const transformer = await plugin.transform({ fix: 'reject()' });

        const out = await run(transformer, [{ a: 1 }, { b: 2 }]);

        expect(out).toHaveLength(0);
    });

    test("a Fix passed as a file path is read from disk", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-fix-"));
        const file = path.join(dir, "script.fix");
        fs.writeFileSync(file, 'add_field("from","file")');

        try {
            const plugin = await loadPlugin("fix", "transform");
            const mapper = await plugin.createMapper({ fix: file });
            expect(mapper({})).toEqual({ from: "file" });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("an empty Fix script is an identity pass-through", async () => {
        const plugin = await loadPlugin("fix", "transform");
        const mapper = await plugin.createMapper({});

        expect(mapper({ a: 1 })).toEqual({ a: 1 });
    });

    test("a terminal to_rdf() converts the built JSON-LD into a quads-Record", async () => {
        const fix = [
            "add_field('@context.@vocab', 'http://example.org/')",
            "add_field('@id', 'http://example.org/a')",
            "add_field('name', 'hello')",
            "to_rdf()",
        ].join("\n");

        const plugin = await loadPlugin("fix", "transform");
        const mapper = await plugin.createMapper({ fix });

        const out = await mapper({});

        // No leftover marker, and a real quads-Record came back.
        expect(out["@@toRDF"]).toBeUndefined();
        expect(Array.isArray(out.quads)).toBe(true);
        expect(out.quads).toContainEqual(
            expect.objectContaining({
                subject: { type: "NamedNode", value: "http://example.org/a" },
                predicate: { type: "NamedNode", value: "http://example.org/name" },
                object: expect.objectContaining({ type: "Literal", value: "hello" }),
            }),
        );
    });

    test("to_rdf(.) treats `.` as the root path, not a skolem prefix", async () => {
        // `.` is the conventional whole-record argument; it must NOT skolemize.
        const fix = [
            "add_field('@context.@vocab', 'http://example.org/')",
            "add_field('@id', 'http://example.org/a')",
            "add_field('knows.name', 'bob')",   // nested anonymous node -> blank node
            "to_rdf(.)",
        ].join("\n");

        const plugin = await loadPlugin("fix", "transform");
        const mapper = await plugin.createMapper({ fix });

        const out = await mapper({});

        const knows = out.quads.find((q: any) => q.predicate.value === "http://example.org/knows");
        // Still a blank node (default mode), not a "." -prefixed IRI.
        expect(knows.object.type).toBe("BlankNode");
        expect(knows.object.value.startsWith(".")).toBe(false);
    });

    test("to_rdf(., skolem:'<prefix>') skolemizes blank nodes to IRIs", async () => {
        const prefix = "https://example.org/.well-known/genid/";
        const fix = [
            "add_field('@context.@vocab', 'http://example.org/')",
            "add_field('@id', 'http://example.org/a')",
            "add_field('knows.name', 'bob')",   // nested anonymous node -> blank node
            `to_rdf(., skolem:'${prefix}')`,
        ].join("\n");

        const plugin = await loadPlugin("fix", "transform");
        const mapper = await plugin.createMapper({ fix });

        const out = await mapper({});

        const knows = out.quads.find((q: any) => q.predicate.value === "http://example.org/knows");
        expect(knows.object.type).toBe("NamedNode");
        expect(knows.object.value.startsWith(prefix)).toBe(true);
        expect(out.quads.some((q: any) => q.object.type === "BlankNode")).toBe(false);
    });
});
