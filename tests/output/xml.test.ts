import { describe, test, expect } from "@jest/globals";
import { loadPlugin } from "../../dist/plugin-loader.js";
import { Readable } from 'node:stream';
import 'jest-xml-matcher';

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

describe("output/xml", () => {
    test("transform converts output correctly", async () => {
        const plugin = await loadPlugin("xml", "output");
        const transformer = await plugin.transform(); 

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from([json], { objectMode: true }).pipe(transformer);
        });

        const output = results.join("");

        // @ts-ignore (it works..i just know)
        expect(output).toEqualXML(data);
    });
});