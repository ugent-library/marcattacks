import { Readable } from "stream";
import streamArray from "stream-json/streamers/StreamArray.js";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable, _opts: any) : Promise<Readable> {
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
        destroy() {
            stream.destroy();
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
    });

    pipeline.on('end', () => {
        readableStream.push(null);
    });

    return readableStream;
}