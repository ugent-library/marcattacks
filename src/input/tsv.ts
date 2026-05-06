import { Transform, type TransformCallback } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(opts: { delimiter: string }): Promise<Transform> {
    let recordNum = 0;
    let tail = "";
    let keys : string[];
    let delimiter : string = opts['delimiter'] ?
        opts['delimiter'].replace("\\t","\t") : "\t";
    
    return new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: string , callback: TransformCallback) {
            const lines = (tail + chunk.toString()).split(/\r?\n/);
            tail = lines.pop() || "";

            for (const line of lines) {
                recordNum++;

                if (!line.trim()) continue;

                const fields = line.split(delimiter);

                if (!keys) {
                    keys = fields;
                    continue;
                }

                if (keys.length != fields.length) {
                    logger.error(`Error on line ${recordNum}, unexpected columns`);
                    continue;
                }

                let data : any = {};
                
                for (let i = 0 ; i < keys.length ; i++) {
                    data[keys[i]!] = fields[i];
                }

                this.push(data);
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