import { Readable } from "stream";
import streamArray from "stream-json/streamers/StreamArray.js";
import log4js from 'log4js';

const logger = log4js.getLogger();

export function stream2readable(stream: Readable) : Readable {
    let recordNum = 0;

    const pipeline = stream.pipe(streamArray.withParser());

    let sourcePaused = false;

    const readableStream = new Readable({
        read() {
            if (sourcePaused) {
                logger.debug("backpressure off");
                pipeline.resume(); 
                sourcePaused = false;
            }
        } ,
        objectMode: true 
    });


    pipeline.on('data', (data: any) => {
        const ok = readableStream.push(data.value);

        if (!ok) {
            logger.debug("backpressure on")
            pipeline.pause();
            sourcePaused = true;
        }

        recordNum++;

        if (recordNum % 1000 === 0) {
            logger.info(`record: ${recordNum}`);
        }
    });

    pipeline.on('end', () => {
        logger.info(`processed ${recordNum} records`);
    });

    return readableStream;
}