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
            // Wait for the JSON parser to drain before completing the flush,
            // otherwise records emitted asynchronously after end() are lost.
            jsonParser.on('end', () => callback());
            jsonParser.end();
        }
    });

    jsonParser.on('data', (data: any) => {
        transformer.push(data.value);
    });

    jsonParser.on('error', (err: any) => transformer.destroy(err));

    return transformer;
}