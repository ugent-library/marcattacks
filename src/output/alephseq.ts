import { Readable, Writable } from 'stream';
import { marcmap } from '../marcmap.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

export function readable2writable(readable: Readable, writable: Writable) : void {
    readable.on('data', async (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

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

        const ok = writable.write(output);

        if (!ok) {
            logger.debug("backpressure on");
            readable.pause();
            writable.once("drain", () => {
                logger.debug("backpressure off");
                readable.resume()
            });
        }
    });

    readable.on('end', () => {
        writable.end();
    });
}