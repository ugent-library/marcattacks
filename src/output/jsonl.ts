import { Readable, Writable } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export function readable2writable(readable: Readable, writable: Writable) : void {
    readable.on('data', (data: any) => {
        const ok = writable.write(JSON.stringify(data) + "\n");

        if (!ok) {
            logger.debug("backpressure on");
            readable.pause();
            writable.once('drain' , () => {
                logger.debug("backpressure off");
                readable.resume();
            });
        }
    });

    readable.on('close', () => {
        writable.end();
    });
}