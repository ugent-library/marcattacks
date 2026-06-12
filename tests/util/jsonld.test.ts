import { describe, test, expect } from "@jest/globals";
import { toRDF, toTurtle, toNTriples, documentLoader, registerContext } from "../../dist/util/jsonld.js";

describe("util/jsonld", () => {
    test("toRDF converts an inline-@context JSON-LD object into quads", async () => {
        const record = await toRDF({
            "@context": { "ex": "http://example.org/" },
            "@id": "ex:a",
            "ex:b": { "@id": "ex:c" },
        });

        expect(record.quads).toContainEqual({
            subject: { type: "NamedNode", value: "http://example.org/a" },
            predicate: { type: "NamedNode", value: "http://example.org/b" },
            object: { type: "NamedNode", value: "http://example.org/c" },
        });
    });

    const jsonldWithBnode = {
        "@context": { "@vocab": "http://example.org/" },
        "@id": "http://example.org/a",
        "knows": { "name": "bob" },          // nested anonymous node -> blank node
    };

    function bnodeLabel(record: any): string {
        const q = record.quads.find((q: any) => q.predicate.value === "http://example.org/knows");
        return q.object.value;
    }

    test("toRDF relabels blank nodes uniquely per call (no cross-record clash)", async () => {
        const a = await toRDF(jsonldWithBnode);
        const b = await toRDF(jsonldWithBnode);

        const labelA = bnodeLabel(a);
        const labelB = bnodeLabel(b);

        // Still blank nodes, but the two records got different labels...
        expect(a.quads).toContainEqual(
            expect.objectContaining({ object: { type: "BlankNode", value: labelA } }),
        );
        expect(labelA).not.toBe(labelB);

        // ...and within one record subject and object share the same label.
        expect(a.quads).toContainEqual(
            expect.objectContaining({
                subject: { type: "BlankNode", value: labelA },
                predicate: { type: "NamedNode", value: "http://example.org/name" },
            }),
        );
    });

    test("toRDF skolemizes blank nodes to IRIs under the given prefix", async () => {
        const prefix = "https://example.org/.well-known/genid/";
        const record = await toRDF(jsonldWithBnode, { skolem: prefix });

        const label = bnodeLabel(record);
        expect(label.startsWith(prefix)).toBe(true);
        // It is now a NamedNode, not a BlankNode.
        expect(record.quads).toContainEqual(
            expect.objectContaining({
                subject: { type: "NamedNode", value: label },
                predicate: { type: "NamedNode", value: "http://example.org/name" },
                object: expect.objectContaining({ type: "Literal", value: "bob" }),
            }),
        );
        expect(record.quads.some((q: any) => q.object.type === "BlankNode")).toBe(false);
    });

    test("toRDF carries datatype and language on literal objects", async () => {
        const record = await toRDF({
            "@context": { "ex": "http://example.org/" },
            "@id": "ex:a",
            "ex:label": { "@value": "hello", "@language": "en" },
            "ex:count": { "@value": "5", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
        });

        expect(record.quads).toContainEqual(
            expect.objectContaining({
                predicate: { type: "NamedNode", value: "http://example.org/label" },
                object: expect.objectContaining({ type: "Literal", value: "hello", language: "en" }),
            }),
        );
        expect(record.quads).toContainEqual(
            expect.objectContaining({
                predicate: { type: "NamedNode", value: "http://example.org/count" },
                object: expect.objectContaining({
                    type: "Literal",
                    value: "5",
                    as: "http://www.w3.org/2001/XMLSchema#integer",
                }),
            }),
        );
    });

    const jsonldLiteral = {
        "@context": { "ex": "http://example.org/" },
        "@id": "ex:a",
        "ex:name": "Alice",
    };

    test("toTurtle serializes JSON-LD to a Turtle string", async () => {
        const ttl = await toTurtle(jsonldLiteral);
        // No prefixes are carried, so full IRIs and a Turtle-style "." terminator.
        expect(ttl).toContain('<http://example.org/a> <http://example.org/name> "Alice".');
    });

    test("toTurtle accepts a format override (N-Triples)", async () => {
        const nt = await toTurtle(jsonldLiteral, { format: "N-Triples" });
        // N-Triples puts a space before the terminating dot.
        expect(nt).toContain('<http://example.org/a> <http://example.org/name> "Alice" .');
    });

    test("toTurtle skolemizes blank nodes to IRIs under the given prefix", async () => {
        const prefix = "https://example.org/.well-known/genid/";
        const ttl = await toTurtle(jsonldWithBnode, { skolem: prefix });
        // Blank node became an IRI under the prefix; no "_:" blank-node syntax.
        expect(ttl).toContain(`<${prefix}`);
        expect(ttl).not.toContain("_:");
    });

    test("toNTriples serializes JSON-LD to an N-Triples string", async () => {
        const nt = await toNTriples(jsonldLiteral);
        expect(nt).toContain('<http://example.org/a> <http://example.org/name> "Alice" .');
    });

    test("toNTriples emits one full-IRI triple per line", async () => {
        const nt = await toNTriples({
            "@context": { "ex": "http://example.org/" },
            "@id": "ex:a",
            "ex:b": { "@id": "ex:c" },
            "ex:name": "Alice",
        });
        const lines = nt.split("\n").filter((l: string) => l.trim() !== "");
        expect(lines).toHaveLength(2);
        // Every line is a complete N-Triple terminated with " ." and uses full IRIs.
        for (const line of lines) {
            expect(line.trimEnd().endsWith(" .")).toBe(true);
            expect(line.startsWith("<http://example.org/a>")).toBe(true);
        }
    });

    test("documentLoader refuses an unregistered URL (no network)", async () => {
        await expect(
            documentLoader("http://unregistered.example/ctx.jsonld"),
        ).rejects.toThrow(/unregistered/);
    });

    test("registerContext lets a remote @context resolve offline", async () => {
        const url = "http://example.org/registered-context.jsonld";
        registerContext(url, { "@context": { "ex": "http://example.org/" } });

        const loaded = await documentLoader(url);
        expect(loaded.documentUrl).toBe(url);
        expect(loaded.document).toEqual({ "@context": { "ex": "http://example.org/" } });

        const record = await toRDF({
            "@context": url,
            "@id": "ex:a",
            "ex:b": { "@id": "ex:c" },
        });

        expect(record.quads).toContainEqual({
            subject: { type: "NamedNode", value: "http://example.org/a" },
            predicate: { type: "NamedNode", value: "http://example.org/b" },
            object: { type: "NamedNode", value: "http://example.org/c" },
        });
    });
});
