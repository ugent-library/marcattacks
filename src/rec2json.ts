import { Readable } from 'stream';
import { marcmap } from './marcmap.js';

export function rec2json(stream: Readable) : void {
    let isFirst = true;

    process.stdout.write("[");

    stream.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

        if (!isFirst) {
            process.stdout.write(',');
        }
        let id = marcmap(rec,"001",{});
        console.log(JSON.stringify({
            "_id": id,
            "record":rec
        }));
        isFirst = false;
    });

    stream.on('end', () => {
        process.stdout.write("]");
    });
}