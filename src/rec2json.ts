import { EventEmitter } from 'node:events';
import { marcmap } from './marcmap.js';

export function rec2json(emitter: EventEmitter) : void {
    let isFirst = true;

    emitter.on("start", () => {
        process.stdout.write("[");
    });

    emitter.on("record", (rec: string[][]) => {
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

    emitter.on("end", () => {
        process.stdout.write("]");
    });
}