import { Readable, Writable } from 'stream';
import { marcmap, marctag, marcind, marcsubfields , marcForEachSub} from '../marcmap.js';

export function readable2writable(readable: Readable, writable: Writable) : void {
    let isFirst = true;

    writable.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    writable.write("<marc:collection xmlns:marc=\"http://www.loc.gov/MARC21/slim\">\n");

    readable.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

        writable.write(" <marc:record>\n");
        let leader = marcmap(rec,"LDR",{})[0];
        writable.write(`  <marc:leader>${leader}</marc:leader>\n`);
        for (let i = 0 ; i < rec.length ; i++) {
            let tag = marctag(rec[i]);
            let ind = marcind(rec[i]); 
            if (tag.match(/^00/)) {
                let value = marcsubfields(rec[i]!,/.*/)[0];
                writable.write(`  <marc:controlfield tag="${tag}">${escapeXML(value)}</marc:controlfield>\n`);
            }
            else {
                writable.write(`  <marc:datafield tag="${tag}" ind1="${ind[0]}" ind2="${ind[1]}">\n`);
                marcForEachSub(rec[i], (code,value) => {
                    writable.write(`    <marc:subfield code="${code}">${escapeXML(value)}</marc:subfield>\n`);
                });
                writable.write(`  </marc:datafield>\n`);
            }
        }
        writable.write(" </marc:record>\n");
    }); 

    readable.on('end', () => {
        writable.write("</marc:collection>\n");
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