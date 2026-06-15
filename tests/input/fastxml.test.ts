import { describe, test, expect, jest } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { CLEAN } from "../../dist/util/marc_record.js";
import { Readable } from 'node:stream';
import log4js from "log4js";

const data = `
<?xml version="1.0" encoding="UTF-8"?>
<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:record>
    <marc:controlfield tag="001">990036760400409161</marc:controlfield>
    <marc:datafield tag="035" ind1=" " ind2=" ">
      <marc:subfield code="a">(RUG01)003676040</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="100" ind1="1" ind2=" ">
      <marc:subfield code="a">Cassiers, Paul,</marc:subfield>
      <marc:subfield code="d">1965-2025</marc:subfield>
    </marc:datafield>
  </marc:record>
</marc:collection>
`.trim();

const json = {
    "record": [
        ["001", " ", " ", "_", "990036760400409161"],
        ["035", " ", " ", "a", "(RUG01)003676040"],
        ["100", "1", " ", "a", "Cassiers, Paul,", "d", "1965-2025"]
    ]
};

// Exercises leader, single-quoted attributes, named + numeric entities.
const tricky = `
<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:record>
    <marc:leader>00100nam a2200037 a 4500</marc:leader>
    <marc:datafield tag='245' ind1='1' ind2='0'>
      <marc:subfield code='a'>Tom &amp; Jerry &#65;</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="920" ind1=" " ind2="&quot;">
      <marc:subfield code="a">book</marc:subfield>
    </marc:datafield>
  </marc:record>
</marc:collection>
`.trim();

const trickyJson = {
    "record": [
        ["LDR", " ", " ", "_", "00100nam a2200037 a 4500"],
        ["245", "1", "0", "a", "Tom & Jerry A"],
        ["920", " ", "\"", "a", "book"]
    ]
};

async function run(plugin: any, input: string): Promise<any[]> {
    const transformer = await plugin.transform();
    const results: any[] = [];
    await new Promise((resolve, reject) => {
        transformer.on('data', (chunk: any) => results.push(chunk));
        transformer.on('end', resolve);
        transformer.on('error', reject);
        Readable.from(input + "\n").pipe(transformer);
    });
    return results;
}

describe("input/fastxml", () => {
    test("transform converts input correctly", async () => {
        const plugin = await loadPlugin("fastxml", "input");
        const results = await run(plugin, data);
        expect(results[0].record).toStrictEqual(json.record);
    });

    test("handles leader, single-quoted attributes and entities", async () => {
        const plugin = await loadPlugin("fastxml", "input");
        const results = await run(plugin, tricky);
        expect(results[0].record).toStrictEqual(trickyJson.record);
    });

    test("marks records clean without leaking into JSON serialisation", async () => {
        const plugin = await loadPlugin("fastxml", "input");
        const results = await run(plugin, data);
        expect(results[0][CLEAN]).toBe(true);
        // the marker is a Symbol, so it must not appear in JSON output
        expect(JSON.stringify(results[0])).not.toContain("clean");
        expect(Object.keys(results[0])).toStrictEqual(["record"]);
    });

    test("output matches the SAX xml reader on the same input", async () => {
        const fast = await loadPlugin("fastxml", "input");
        const sax = await loadPlugin("xml", "input");
        const a = await run(fast, data);
        const b = await run(sax, data);
        expect(a.map(r => r.record)).toStrictEqual(b.map(r => r.record));
    });

    test("logs FATAL when a large input yields no records (e.g. alephseq)", async () => {
        // spy on the Logger prototype: the module holds its own logger instance,
        // but every instance shares the prototype's fatal()
        const proto = Object.getPrototypeOf(log4js.getLogger());
        const fatal = jest.spyOn(proto, "fatal").mockImplementation(() => {});
        try {
            const plugin = await loadPlugin("fastxml", "input");
            // >1 MB of Aleph sequential lines — no <record> elements at all
            const line = "9936780231909161 035   L $$a(CKB)4100000011923202\n";
            const alephseq = line.repeat(Math.ceil((1 << 20) / line.length) + 100);
            const results = await run(plugin, alephseq);
            expect(results).toHaveLength(0);
            expect(fatal).toHaveBeenCalledTimes(1);
            expect(String(fatal.mock.calls[0]?.[0])).toContain("alephseq");
        } finally {
            fatal.mockRestore();
        }
    });

    test("does not warn on valid MARCXML", async () => {
        const proto = Object.getPrototypeOf(log4js.getLogger());
        const fatal = jest.spyOn(proto, "fatal").mockImplementation(() => {});
        try {
            const plugin = await loadPlugin("fastxml", "input");
            await run(plugin, data);
            expect(fatal).not.toHaveBeenCalled();
        } finally {
            fatal.mockRestore();
        }
    });
});
