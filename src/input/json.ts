import { Readable } from "stream";
import streamArray from "stream-json/streamers/StreamArray.js";
import log4js from 'log4js';

const logger = log4js.getLogger();

export function stream2readable(stream: Readable) : Readable {
    let recordNum = 0;

    const readableStream = new Readable({
        read() {} ,
        objectMode: true 
    });

    const pipeline = stream.pipe(streamArray.withParser());

    pipeline.on('data', (data: any) => {
        readableStream.push(data.value);
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