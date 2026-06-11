import { Transform, type TransformCallback } from "stream";
import { Marc } from "marcjs";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts: any): Promise<Transform> {
    const parser = Marc.createStream('Iso2709', 'Parser');

    const transformer = new Transform({
        objectMode: true,
        transform(chunk: any, _encoding: string, callback: TransformCallback) {
            parser.write(chunk); //
            callback();
        },
        flush(callback: TransformCallback) {
            // The marcjs Iso2709 parser drains its internal record queue
            // asynchronously (one record per setImmediate tick), so we must
            // wait for it to emit 'end' before completing the flush, otherwise
            // records still queued when this Transform ends are lost.
            parser.on('end', () => callback());
            parser.end();
        }
    });

    parser.on('data', (record) => {
        let rec: string[][] = [];

        rec.push(['LDR', ' ', ' ', '_', record.leader]);

        for (const field of record.fields) {
            const tag = field[0];

            if (field.length == 2 && tag.startsWith("00")) {
                const ind1 = ' ';
                const ind2 = ' ';
                const data = field.slice(1);
                rec.push([tag, ind1, ind2].concat(data)); //
            } else if (field.length > 3) {
                const ind1 = field[1].charAt(0);
                const ind2 = field[1].charAt(1);
                const data = field.slice(2);
                rec.push([tag, ind1, ind2].concat(data)); //
            } else {
                logger.warn("marc error: ", field); //
            }
        }

        transformer.push({
            record: rec
        });
    });

    parser.on('error', (err) => {
        transformer.destroy(err);
    });

    return transformer;
}