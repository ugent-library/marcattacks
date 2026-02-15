import { Transform } from 'stream';
import { marctag, marcind, marcsubfields , marcForEachSub} from '../marcmap.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_param:any) : Promise<Transform> {
    let isFirst = true;

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                logger.debug('skipped empty record');
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
                    output += `  <marc:controlfield tag="${escapeXML(tag,{forAttribute:true})}">${escapeXML(value)}</marc:controlfield>\n`;
                }
                else {
                    output += `  <marc:datafield tag="${escapeXML(tag)}" ind1="${escapeXML(ind[0],{forAttribute:true})}" ind2="${escapeXML(ind[1],{forAttribute:true})}">\n`;
                    marcForEachSub(rec[i], (code,value) => {
                        output += `    <marc:subfield code="${escapeXML(code)}">${escapeXML(value)}</marc:subfield>\n`;
                    });
                    output += `  </marc:datafield>\n`;
                }
            }

            output += " </marc:record>\n";

            logger.trace(`adding ${output.length} bytes`);

            callback(null,output);
        },
        flush(callback) {
            logger.debug('flush reached');
            if (!isFirst) {
                logger.debug("flushing");
                let output = "</marc:collection>\n";
                logger.trace(`adding ${output.length} bytes`);
                this.push(output); 
            }
            callback();
        }
    });
}

export function escapeXML(
  value: string | number | null | undefined,
  options?: { forAttribute?: boolean }
): string {
    if (value === null || value === undefined) return '';

    let s = String(value);

    // STEP 1: Remove/replace invalid UTF-8 and disallowed XML characters
    
    // Remove unpaired UTF-16 surrogates (invalid in JSON and problematic in XML)
    s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD');  // unpaired high surrogates
    s = s.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'); // unpaired low surrogates
    
    // Remove other disallowed XML 1.0 characters:
    // Control chars: 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F-0x9F
    // Non-characters: 0xFFFE, 0xFFFF, 0x1FFFE, 0x1FFFF, etc.
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '');
    
    // Remove other non-characters (U+FFFE, U+FFFF in other planes)
    // These can occur as U+FFFE, U+FFFF, U+1FFFE, U+1FFFF, etc.
    s = s.replace(/[\uFDD0-\uFDEF]/g, '');

    // STEP 2: Escape XML special characters
    // IMPORTANT: Always escape & FIRST to avoid double-escaping
    s = s.replace(/&/g, '&amp;');
    
    // Escape other special characters
    s = s.replace(/</g, '&lt;');
    s = s.replace(/>/g, '&gt;');

    if (options?.forAttribute) {
        s = s.replace(/"/g, '&quot;');
        s = s.replace(/'/g, '&apos;');
    }

    return s;
}