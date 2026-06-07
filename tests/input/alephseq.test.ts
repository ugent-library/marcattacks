import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';

const data = `
990036760400409161 FMT   L BK
990036760400409161 001   L 990036760400409161
990036760400409161 035   L $$a(RUG01)003676040
990036760400409161 1001  L $$aCassiers, Paul,$$d1965-2025
`.trim();

const json = {
    "_id": "990036760400409161",
    "record": [
        ["FMT", " ", " ", "_", "BK"],
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
};

describe("input/alephseq", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("alephseq", "input");
        const transformer = await plugin.transform(); 

        const results: any[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data + "\n").pipe(transformer);
        });

        expect(results[0]).toStrictEqual(json);
    });

    test("handles UTF-8 multi-byte chars split across chunk boundaries", async () => {
        const plugin = await loadPlugin("alephseq", "input");
        const transformer = await plugin.transform();
        // a record whose title contains multi-byte UTF-8 (é, 宮, 𝐀)
        const rec = [
            "000000001 FMT   L BK",
            "000000001 24510 L $$acafé 宮川 𝐀test",
        ].join("\n") + "\n";

        const results: any[] = [];
        await new Promise((resolve, reject) => {
            transformer.on("data", (c: any) => results.push(c));
            transformer.on("end", resolve);
            transformer.on("error", reject);
            // feed 1 byte at a time -> guarantees multi-byte chars straddle chunks
            const buf = Buffer.from(rec, "utf8");
            const r = new Readable({
                read() {
                    if (this._i === undefined) this._i = 0;
                    if (this._i >= buf.length) { this.push(null); return; }
                    this.push(buf.subarray(this._i, this._i + 1)); this._i++;
                },
            } as any);
            r.pipe(transformer);
        });

        // the title value must be intact (no U+FFFD replacement chars)
        const title = results[0].record.find((f: string[]) => f[0] === "245");
        expect(title).toEqual(["245", "1", "0", "a", "café 宮川 𝐀test"]);
        expect(JSON.stringify(results[0])).not.toContain("�");
    });
});