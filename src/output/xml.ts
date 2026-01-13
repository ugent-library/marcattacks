import { Transform } from 'stream';
import { marctag, marcind, marcsubfields , marcForEachSub} from '../marcmap.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform() : Promise<Transform> {
    let isFirst = true;
    let hasClosed = false;

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                callback()
                return;
            }

            let output = "";

            if (isFirst) {
                output += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
                output += "<marc:collection xmlns:marc=\"http://www.loc.gov/MARC21/slim\">\n";
                isFirst = false;
            }
        
            output += " <marc:record>\n";

            for (let i = 0 ; i < rec.length ; i++) {
                let tag = marctag(rec[i]);
                let ind = marcind(rec[i]); 
                if (tag === 'FMT') {}
                else if (tag === 'LDR') {
                    let value = marcsubfields(rec[i]!,/.*/)[0];
                    output += `  <marc:leader>${escapeXML(value)}</marc:leader>\n`;
                }
                else if (tag.match(/^00/)) {
                    let value = marcsubfields(rec[i]!,/.*/)[0];
                    output += `  <marc:controlfield tag="${tag}">${escapeXML(value)}</marc:controlfield>\n`;
                }
                else {
                    output += `  <marc:datafield tag="${tag}" ind1="${ind[0]}" ind2="${ind[1]}">\n`;
                    marcForEachSub(rec[i], (code,value) => {
                        output += `    <marc:subfield code="${code}">${escapeXML(value)}</marc:subfield>\n`;
                    });
                    output += `  </marc:datafield>\n`;
                }
            }

            output += " </marc:record>\n";

            logger.debug(`adding ${output.length} bytes`);

            callback(null,output);
        },
        flush(callback) {
            if (!isFirst && !hasClosed) {
                logger.debug("flushing");
                let output = "</marc:collection>\n";
                logger.debug(`adding ${output.length} bytes`);
                this.push(output); 
                hasClosed = true;
            }
            callback();
        },
        destroy(err, callback) {
            callback(err);
        }
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