import { Transform, type TransformCallback } from "stream";
import { StringDecoder } from "node:string_decoder";
import log4js from 'log4js';

const logger = log4js.getLogger();

const VALID_LINE = /^\w+\s[\x20-\x7E]{5}\sL\s/;  // <id> <tag+ind1+ind2> L <data>
const SUBFIELD = /\$\$(.)/;                       // splits "$$avalue" subfields

export async function transform(_opts: any): Promise<Transform> {
    let recordNum = 0;
    let rec: string[][] = [];
    let previd: string = "";
    let tail = "";
    // decode bytes to UTF-8 across chunk boundaries (a multi-byte character may
    // be split between two chunks; StringDecoder buffers the incomplete bytes)
    const decoder = new StringDecoder("utf8");

    function processLine(line: string, stream: Transform): boolean {
        // Validate the line prefix "<id> <tag+ind> L ". Same accept/reject as
        // the original /^\w+\s[\x20-\x7E]{5}\sL\s.*/u but cheaper: no trailing
        // .* (it always matched), no /u (ASCII only), and test() not match().
        if (!VALID_LINE.test(line)) {
            logger.warn(`syntax error in record ${recordNum + 1}`);
            logger.warn(`skipping> ${line}`);
            return false;
        }

        // Split id from the rest on the first space (was split(" ")+join(" "),
        // which split the whole line on every space and rejoined it).
        const sp = line.indexOf(" ");
        const id = line.slice(0, sp);
        const lineData = line.slice(sp + 1);

        if (previd && previd !== id) {
            stream.push({ record: rec });
            rec = [];
            recordNum++;
        }

        const tag  = lineData.substring(0, 3);
        const ind1 = lineData.substring(3, 4);
        const ind2 = lineData.substring(4, 5);
        const sf   = lineData.substring(8);
        const parts = sf.split(SUBFIELD);

        if (tag === 'FMT' || tag === 'LDR' || tag.startsWith("00")) {
            rec.push([tag, ind1, ind2, "_", ...parts]);
        } else {
            rec.push([tag, ind1, ind2, ...parts.slice(1)]);
        }

        previd = id!;
        return true;
    }

    return new Transform({
        objectMode: true,

        transform(chunk: any, _encoding: string, callback: TransformCallback) {
            const data = tail + decoder.write(chunk);
            const lines = data.split(/\r?\n/);

            tail = lines.pop() || "";

            for (const line of lines) {
                if (line.length === 0) continue;
                processLine(line,this);
            }

            callback();
        },

        flush(callback: TransformCallback) {
            tail += decoder.end();   // flush any buffered trailing bytes
            if (tail.length > 0) {
                processLine(tail,this);
            }

            if (rec.length > 0) {
                this.push({ record: rec });
            }
            callback();
        }
    });
}