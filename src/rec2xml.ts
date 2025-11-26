import { EventEmitter } from 'node:events';
import { marcmap, marctag, marcind, marcsubfields , marcsubf} from './marcmap.js';

export function rec2xml(emitter: EventEmitter) : void {
    let isFirst = true;

    emitter.on("start", () => {
        console.log("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        console.log("<marc:collection xmlns:marc=\"http://www.loc.gov/MARC21/slim\">");
    });

    emitter.on("record", (rec: string[][]) => {
        console.log(" <marc:record>");
        let leader = marcmap(rec,"LDR",{})[0];
        console.log(`  <marc:leader>${leader}</marc:leader>`);
        for (let i = 0 ; i < rec.length ; i++) {
            let tag = marctag(rec[i]);
            let ind = marcind(rec[i]); 
            if (tag.match(/^00/)) {
                let value = marcsubfields(rec[i]!,/.*/)[0];
                console.log(`  <marc:controlfield tag="${tag}">${escapeXML(value)}</marc:controlfield>`);
            }
            else {
                console.log(`  <marc:datafield tag="${tag}" ind1="${ind[0]}" ind2="${ind[1]}">`);
                marcsubf(rec[i], (code,value) => {
                    console.log(`    <marc:subfield code="${code}">${escapeXML(value)}</marc:subfield>`);
                });
                console.log(`  </marc:datafield>`);
            }
        }
        console.log(" </marc:record>");
    }); 

    emitter.on("end", () => {
        console.log("</marc:collection>");
    });
}

export function escapeXML(
  value: string | number | null | undefined,
  options?: { forAttribute?: boolean }
): string {
    if (value === null || value === undefined) return '';

    let s = String(value);

    // Remove control chars that are disallowed in XML 1.0:
    // keep tab (0x09), newline (0x0A), carriage return (0x0D)
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');

    // Escape ampersand that are NOT part of a valid entity (avoid double-escape)
    // Valid entity patterns: &name;  or  &#123;  or  &#x1A;
    s = s.replace(/&(?!(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);)/g, '&amp;');

    // Escape the rest
    s = s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (options?.forAttribute) {
        s = s.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    return s;
}