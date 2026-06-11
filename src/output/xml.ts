import { Transform } from 'stream';
import { marctag, marcind, marcsubfields , marcForEachSub} from '../marcmap.js';
import { escapeXML } from '../util/xml_escape.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts:any) : Promise<Transform> {
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
                    output += `  <marc:datafield tag="${escapeXML(tag,{forAttribute:true})}" ind1="${escapeXML(ind[0],{forAttribute:true})}" ind2="${escapeXML(ind[1],{forAttribute:true})}">\n`;
                    marcForEachSub(rec[i], (code,value) => {
                        output += `    <marc:subfield code="${escapeXML(code,{forAttribute:true})}">${escapeXML(value)}</marc:subfield>\n`;
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
