import { Transform, type TransformCallback } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts: any): Promise<Transform> {
    let recordNum = 0;
    let tail = "";

    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: string , callback: TransformCallback) {
            const lines = (tail + chunk.toString()).split(/\r?\n/);
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
            if (tail.trim()) {
                try {
                    this.push(JSON.parse(tail));
                } catch (e) { /* ignore trailing whitespace */ }
            }
            callback();
        }
    });
}