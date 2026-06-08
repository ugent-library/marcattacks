import { describe, test, expect } from "@jest/globals";
import { toRDF, documentLoader, registerContext } from "../../dist/util/jsonld.js";

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
