import { Readable, Writable } from 'stream';
import { marcmap } from '../marcmap.js';

import log4js from 'log4js';

const logger = log4js.getLogger();

export function readable2writable(readable: Readable, writable: Writable) : void {
    let isFirst = true;

    writable.write("[");

    readable.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        let output = "";

        if (!rec) return;

        if (!isFirst) {
            output += ',';
        }

        let id = marcmap(rec,"001",{}).join(" ");
        output += JSON.stringify(data);

        const ok = writable.write(output);

        if (!ok) {
            logger.debug("backpressure on");
            readable.pause();
            writable.once('drain' , () => {
                logger.debug("backpressure off");
                readable.resume();
            });
        }
        
        isFirst = false;
    });

    readable.on('end', () => {
        writable.write("]");
    });
}
