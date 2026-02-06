import { Transform } from "stream";
import { marcmap } from "../marcmap.js";

/**
 * Transform to a stream of [Avram](https://format.gbv.de/schema/avram/specification) records
 */
export async function transform(_param: any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                callback(null);
                return;
            }

            const avram : any = { fields: []};
            
            for (let i = 0 ; i < rec.length ; i++) {
                const field = rec[i];
                const tag   = field?.[0]!;
                const ind1  = field?.[1]!;
                const ind2  = field?.[2]!;
                const data  = field?.[4]!;
                const subfields = field?.splice(3);

                if (tag === 'LDR') {
                    avram.fields.push({ tag: 'LDR' , value: data });
                }
                else if (tag.startsWith('00')) {
                    avram.fields.push({ tag: 'LDR' , value: data });
                }
                else {
                    avram.fields.push({ tag, indicator1: ind1 , indicator2: ind2 , subfields });
                }
            }

            callback(null,avram);
        }
    });
}