import { Readable } from "stream";
import { Marc } from "marcjs";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable, _opts: any) : Promise<Readable> {
    let recordNum = 0;
    let hasError = false;
    let sourcePaused = false;

    const parser = Marc.createStream('Iso2709', 'Parser');

    const readableStream = new Readable({
        read() {
            if (sourcePaused) {
                logger.debug("backpressure off");
                parser.resume();
                sourcePaused = false;
            }
        } ,
        destroy() {
            stream.destroy();
        } ,
        objectMode: true 
    });

    parser.on('data', (record) => {
        recordNum++;

        if (recordNum % 1000 === 0) {
            logger.info(`record: ${recordNum}`);
        }

        let rec : string[][] = [];

        rec.push([ 'LDR' , ' ' , ' ' , '_', record.leader]);

        for (const field of record.fields) {
            const tag  = field[0];

            if (field.length == 2 && tag.startsWith("00")) {
                const ind1 = ' ';
                const ind2 = ' ';
                const data = field.slice(1);

                rec.push([ tag , ind1, ind2].concat(data));
            }
            else if (field.length > 3) {
                const ind1 = field[1].charAt(0);
                const ind2 = field[1].charAt(1);
                const data = field.slice(2);

                rec.push([ tag , ind1, ind2].concat(data));
            }
            else {
                logger.warn("marc error: ", field);
            }
        }

        const ok = readableStream.push({
            record:  rec
        });

        if (!ok) {
            logger.debug("backpressure on");
            parser.pause();
            sourcePaused = true; 
        }
    });

    parser.on('close', () => {
        if (recordNum % 1000 === 0) {
            logger.info(`record: ${recordNum}`);
        }
        readableStream.push(null);
        logger.info(`processed ${recordNum} records`);
    });
    
    stream.pipe(parser);

    return readableStream;
}