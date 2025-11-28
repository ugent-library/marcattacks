import { Readable, Writable } from 'stream';
import { marcmap } from '../marcmap.js';

export function readable2writable(readable: Readable, writable: Writable) : void {
    readable.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

        let id = marcmap(rec,"001",{});
        let rows : string[] = [];

        for (let i = 0 ; i < rec.length ; i++) {
            const facts = rec[i]!.map(s => `${escapePrologString(s)}`);
            rows.push(`[${facts.join(',')}]`);
        }

        writable.write(`data(${id},[${rows.join(",")}]).\n`);
    });
}

function escapePrologString(str: string) : string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}