import { Readable } from "stream";
import * as readline from 'node:readline'
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable, _opts: any) : Promise<Readable> {
    let recordNum = 0;
    let hasError = false;

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
        destroy() {
            stream.destroy();
        } ,
        objectMode: true 
    });

    rl.on('line', (line) => {
        if (hasError) return;

        recordNum++;

        try {
            const ok = readableStream.push(JSON.parse(line));

            if (!ok) {
                logger.debug("backpressure on");
                rl.pause();
                sourcePaused = true; 
            }

            recordNum++;
        } catch (error) {
            hasError = true;
            logger.error(`JSON parse error at line ${recordNum + 1}: ${error}`);
            stream.destroy();
            rl.close();
            readableStream.destroy(error instanceof Error ? error : new Error(String(error)));
        }
    });

    rl.on('error', (error) => {
        if (hasError) return;
        logger.error(`readline error ${error}`);
    });

    rl.on('close', () => {
        if (hasError) return;
        readableStream.push(null);
    });

    return readableStream;
}