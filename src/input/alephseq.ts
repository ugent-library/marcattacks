import { Readable } from "stream";
import * as readline from 'node:readline'
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable, _opts: any) : Promise<Readable> {
    let recordNum = 0;
    let hasError = false;

    const rl = readline.createInterface({input: stream, crlfDelay: Infinity});

    let sourcePaused = false;

    const readableStream = new Readable({
        read() {
            if (sourcePaused) {
                logger.debug("backpressure off");
                rl.resume(); 
                sourcePaused = false;
            }
        } ,
        destroy() {
            stream.destroy();
        } ,
        objectMode: true 
    });

    let rec : string[][] = [];
    let previd : string = "";

    rl.on('line', (line) => {
        if (hasError) return;

        logger.debug(line);

        if (line.match(/^\w+\s[\x20-\x7E]{5}\sL\s.*/u)) {
            // ok
        }
        else {
            logger.error(`syntax error in record ${recordNum + 1}`);
            hasError = true;
            stream.destroy();
            rl.close();
            readableStream.destroy(new Error(String('parse error')));
            return;
        }

        const [id,...rest] = line.split(" ");
        const data = rest.join(" ");

        if (previd && previd !== id) {
            const ok = readableStream.push({
                record:  rec
            });

            if (!ok) {
                logger.debug("backpressure on");
                rl.pause();
                sourcePaused = true; 
            }
            
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

    rl.on('error', (error) => {
        if (hasError) return;
        logger.error(`readline error ${error}`);
    });

    rl.on('close', () => {
        if (hasError) return;
        readableStream.push({
            record: rec
        });
        readableStream.push(null);
    });

    return readableStream;
}