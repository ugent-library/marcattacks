import { Transform } from 'stream';
import { marcmap } from '../marcmap.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform() : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                logger.debug('skipped empty record');
                callback();
                return;
            }

            let id = marcmap(rec,"001",{});

            let output = `${id} FMT   L BK\n`;

            for (let i = 0 ; i < rec.length ; i++) {
                let tag  = rec[i]![0];
                let ind1 = rec[i]![1];
                let ind2 = rec[i]![2];
                let sf = "";

                for (let j = 3; j < rec[i]!.length ; j += 2) {
                    let code = rec[i]![j];
                    let val  = rec[i]![j+1];
                    if (tag!.match(/^FMT|LDR|00./g)) {
                        sf += `${val}`;
                    }
                    else {
                        sf += `\$\$${code}${val}`;
                    }
                }

                output += `${id} ${tag}${ind1}${ind2} L ${sf}\n`;
            }

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}