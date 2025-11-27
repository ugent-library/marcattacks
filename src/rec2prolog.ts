import { Readable } from 'stream';
import { marcmap } from './marcmap.js';

export function rec2prolog(stream: Readable) : void {
    stream.on('data', (data: any) => {
        let rec : string[][] = data['record'];

        if (!rec) return;

        let id = marcmap(rec,"001",{});
        let rows : string[] = [];

        for (let i = 0 ; i < rec.length ; i++) {
            const facts = rec[i]!.map(s => `${escapePrologString(s)}`);
            rows.push(`[${facts.join(',')}]`);
        }

        console.log(`data(${id},[${rows.join(",")}]).`);
    });
}

function escapePrologString(str: string) : string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}