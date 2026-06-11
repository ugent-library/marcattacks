import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

// Run an array of records through a transform stream and collect the output.
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

describe("transform/avram", () => {
    test("leader becomes LDR, control fields keep their own tag, datafields keep indicators+subfields", async () => {
        const plugin = await loadPlugin("avram", "transform");
        const transformer = await plugin.transform({});

        const record = {
            record: [
                ["LDR", " ", " ", "_", "00000cam"],
                ["001", " ", " ", "_", "990036760400409161"],
                ["245", "1", "0", "a", "A title", "b", "a subtitle"],
            ]
        };

        const [out] = await run(transformer, [record]);

        expect(out).toEqual({
            fields: [
                { tag: 'LDR', value: '00000cam' },
                { tag: '001', value: '990036760400409161' },
                { tag: '245', indicator1: '1', indicator2: '0', subfields: ['a', 'A title', 'b', 'a subtitle'] },
            ]
        });
    });

    test("does not mutate the input record rows", async () => {
        const plugin = await loadPlugin("avram", "transform");
        const transformer = await plugin.transform({});

        const record = {
            record: [
                ["245", "1", "0", "a", "A title", "b", "a subtitle"],
            ]
        };

        await run(transformer, [record]);

        // slice(3), not splice(3): the original row must still hold its subfields.
        expect(record.record[0]).toEqual(["245", "1", "0", "a", "A title", "b", "a subtitle"]);
    });

    test("records without a 'record' key are dropped", async () => {
        const plugin = await loadPlugin("avram", "transform");
        const transformer = await plugin.transform({});

        const out = await run(transformer, [{ foo: "bar" }]);

        expect(out).toHaveLength(0);
    });
});
