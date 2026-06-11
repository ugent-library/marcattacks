import { Transform, type TransformCallback } from "stream";
import { StringDecoder } from "node:string_decoder";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(opts: { delimiter?: string } = {}): Promise<Transform> {
    let recordNum = 0;
    let tail = "";
    let keys : string[];
    let delimiter : string = opts['delimiter'] ?
        opts['delimiter'].replace("\\t","\t") : "\t";
    // decode bytes to UTF-8 across chunk boundaries (a multi-byte character may
    // be split between two chunks; StringDecoder buffers the incomplete bytes)
    const decoder = new StringDecoder("utf8");

    function processLine(line: string, stream: Transform): void {
        recordNum++;

        if (!line.trim()) return;

        const fields = line.split(delimiter);

        if (!keys) {
            keys = fields;
            return;
        }

        if (keys.length != fields.length) {
            logger.error(`Error on line ${recordNum}, unexpected columns`);
            return;
        }

        let data : any = {};

        for (let i = 0 ; i < keys.length ; i++) {
            data[keys[i]!] = fields[i];
        }

        stream.push(data);
    }

    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: string , callback: TransformCallback) {
            const lines = (tail + decoder.write(chunk)).split(/\r?\n/);
            tail = lines.pop() || "";

            for (const line of lines) {
                processLine(line, this);
            }

            callback();
        },
        flush(callback) {
            tail += decoder.end();   // flush any buffered trailing bytes
            if (tail.trim()) {
                processLine(tail, this);
            }
            callback();
        }
    });
}