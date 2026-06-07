import { Transform } from 'stream';
import { CLEAN } from '../util/marc_record.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

// Read the 001 control field value (the record id) without compiling a regex
// per record, as marcmap("001") would. Mirrors marcmap: first matching 001
// row, all of its values joined by a space.
function recordId(rec: string[][]): string {
    for (const row of rec) {
        if (row[0] === '001') {
            let id = '';
            for (let k = 4; k < row.length; k += 2) {
                if (row[k] !== undefined) id = id ? `${id} ${row[k]}` : row[k]!;
            }
            return id;
        }
    }
    return '';
}

// Control fields (00x) and the leader carry a bare value; data fields carry
// $$-prefixed subfields. Equivalent to the old /^LDR|00./ test, without a regex.
function isControl(tag: string): boolean {
    return tag === 'LDR' || (tag[0] === '0' && tag[1] === '0');
}

export async function transform(_opts:any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                logger.debug('skipped empty record');
                callback();
                return;
            }

            // Input readers that strip control chars mark the record clean, so
            // we can skip re-escaping every value here.
            const esc = data[CLEAN] === true ? (v: string) => v : escapeLine;

            let id = recordId(rec);

            if (!id) {
                id = "000000000";
            }
            
            let output = `${id} FMT   L BK\n`;

            for (let i = 0 ; i < rec.length ; i++) {
                let tag  = rec[i]![0];
                let ind1 = rec[i]![1];
                let ind2 = rec[i]![2];
                let sf = "";

                if (tag! === 'FMT') {
                    continue;
                }
                
                for (let j = 3; j < rec[i]!.length ; j += 2) {
                    let code = rec[i]![j];
                    let val  = rec[i]![j+1];

                    if (val === undefined) {
                        // skip undefined values
                        continue;
                    }

                    if (isControl(tag!)) {
                        // Leader and fixed control fields (00x) encode blanks as
                        // '^' in Aleph sequential, so convert spaces back to
                        // carets (the inverse of what the alephseq reader does).
                        sf += `${esc(val).replaceAll(' ', '^')}`;
                    }
                    else {
                        sf += `\$\$${code}${esc(val)}`;
                    }
                }

                output += `${id} ${tag}${ind1}${ind2} L ${sf}\n`;
            }

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}

function escapeLine(val:string) : string {
    return val.replaceAll(/[\x00-\x1F\x7F]/g,'');
}