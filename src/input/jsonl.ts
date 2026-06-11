import { Transform, type TransformCallback } from "stream";
import { StringDecoder } from "node:string_decoder";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts: any): Promise<Transform> {
    let recordNum = 0;
    let tail = "";
    // decode bytes to UTF-8 across chunk boundaries (a multi-byte character may
    // be split between two chunks; StringDecoder buffers the incomplete bytes)
    const decoder = new StringDecoder("utf8");

    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: string , callback: TransformCallback) {
            const lines = (tail + decoder.write(chunk)).split(/\r?\n/);
            tail = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    this.push(JSON.parse(line));
                    recordNum++;
                } catch (error) {
                    logger.error(`JSON parse error at line ${recordNum + 1}: ${error}`);
                    return callback(error instanceof Error ? error : new Error(String(error)));
                }
            }
            callback();
        },
        flush(callback) {
            tail += decoder.end();   // flush any buffered trailing bytes
            if (tail.trim()) {
                // tail is non-whitespace, so a parse failure is a real malformed
                // final record — surface it like the mid-file handler does
                // instead of dropping it silently.
                try {
                    this.push(JSON.parse(tail));
                } catch (error) {
                    logger.error(`JSON parse error at line ${recordNum + 1}: ${error}`);
                    return callback(error instanceof Error ? error : new Error(String(error)));
                }
            }
            callback();
        }
    });
}