import { Readable } from "stream";
import * as readline from 'node:readline'
import log4js from 'log4js';

const logger = log4js.getLogger();

export function stream2readable(stream: Readable) : Readable {
    let recordNum = 0;

    const readableStream = new Readable({
        read() {} ,
        objectMode: true 
    });

    const rl = readline.createInterface({input: stream, crlfDelay: Infinity});

    let rec : string[][] = [];
    let previd : string = "";

    rl.on('line', (line) => {
        const [id,...rest] = line.split(" ");
        const data = rest.join(" ");

        if (previd && previd !== id) {
            readableStream.push({
                _id: previd,
                record:  rec
            });
            rec = [];
            recordNum++;
        }

        const tag  = data?.substring(0,3);
        const ind1 = data?.substring(3,4);
        const ind2 = data?.substring(4,5);
        const sf   = data?.substring(8);
        const parts = sf.split(/\$\$(.)/);

        if (tag == 'FMT' || tag === 'LDR' || tag.startsWith("00")) {
            rec.push([
                tag,ind1,ind2
            ].concat(["_"].concat(parts)));
        }
        else {
            rec.push([
                tag,ind1,ind2
            ].concat(parts.slice(1)));
        }
        
        previd = id!;
    });

    rl.on('close', () => {
        readableStream.push({
            _id: previd,
            record: rec
        });
        readableStream.push(null);
        logger.info(`processed ${recordNum} records`);
    });

    return readableStream;
}