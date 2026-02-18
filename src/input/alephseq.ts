import { Transform, type TransformCallback } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts: any): Promise<Transform> {
    let recordNum = 0;
    let rec: string[][] = [];
    let previd: string = "";
    let tail = "";

    return new Transform({
        objectMode: true,

        transform(chunk: any, _encoding: string, callback: TransformCallback) {
            const data = tail + chunk.toString();
            const lines = data.split(/\r?\n/);

            tail = lines.pop() || "";

            for (const line of lines) {
                if (line.length === 0) continue;

                if (!line.match(/^\w+\s[\x20-\x7E]{5}\sL\s.*/u)) {
                    logger.error(`syntax error in record ${recordNum + 1}`);
                    logger.error(`error> ${line}`);
                    continue;
                }

                const [id, ...rest] = line.split(" ");
                const lineData = rest.join(" ");

                if (previd && previd !== id) {
                    this.push({ record: rec });
                    rec = [];
                    recordNum++;
                }

                const tag  = lineData?.substring(0, 3);
                const ind1 = lineData?.substring(3, 4);
                const ind2 = lineData?.substring(4, 5);
                const sf   = lineData?.substring(8);
                const parts = sf.split(/\$\$(.)/);

                if (tag === 'FMT' || tag === 'LDR' || tag.startsWith("00")) {
                    rec.push([tag, ind1, ind2, "_", ...parts]);
                } else {
                    rec.push([tag, ind1, ind2, ...parts.slice(1)]);
                }
                
                previd = id!;
            }

            callback();
        },

        flush(callback: TransformCallback) {
            if (tail) {
                logger.warn("ignoring partial chunk of data: ", tail);
            }
            
            if (rec.length > 0) {
                this.push({ record: rec });
            }
            callback();
        }
    });
}