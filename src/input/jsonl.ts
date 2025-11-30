import { Readable } from "stream";
import * as readline from 'node:readline'
import log4js from 'log4js';

const logger = log4js.getLogger();

export function stream2readable(stream: Readable) : Readable {
    let recordNum = 0;

    const rl = readline.createInterface({input: stream, crlfDelay: Infinity});

    let sourcePaused = false;

    const readableStream = new Readable({
        read() {
            if (sourcePaused) {
                logger.debug("backpressure off");
                rl.resume(); 
                sourcePaused = false;
            }
        } ,
        objectMode: true 
    });

    rl.on('line', (line) => {
        const ok = readableStream.push(JSON.parse(line));

        if (!ok) {
             logger.debug("backpressure on");
             rl.pause();
             sourcePaused = true; 
        }

        recordNum++;

        if (recordNum % 1000 === 0) {
            logger.info(`record: ${recordNum}`);
        }
    });

    rl.on('close', () => {
        readableStream.push(null);
        logger.info(`processed ${recordNum} records`);
    });

    return readableStream;
}