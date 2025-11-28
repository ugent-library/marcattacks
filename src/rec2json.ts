import { Readable, Writable } from 'stream';
import { marcmap } from './marcmap.js';

export function readable2writable(readable: Readable, writable: Writable) : void {
    let isFirst = true;

    writable.write("[");

    readable.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

        if (!isFirst) {
            writable.write(',');
        }
        let id = marcmap(rec,"001",{});
        writable.write(JSON.stringify({
            "_id": id,
            "record":rec
        }));
        isFirst = false;
    });

    readable.on('end', () => {
        writable.write("]");
    });
}