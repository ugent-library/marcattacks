import { Transform, type TransformCallback } from "stream";
import streamArray from "stream-json/streamers/StreamArray.js";

export async function transform(_opts: any): Promise<Transform> {
    const jsonParser = streamArray.withParser();

    const transformer = new Transform({
        objectMode: true,
        transform(chunk: any, encoding: string, callback: TransformCallback) {
            jsonParser.write(chunk, encoding);
            callback();
        },
        flush(callback) {
            jsonParser.end();
            callback();
        }
    });

    jsonParser.on('data', (data: any) => {
        transformer.push(data.value);
    });

    jsonParser.on('error', (err: any) => transformer.destroy(err));

    return transformer;
}