import { EventEmitter } from 'node:events';
import { marcmap } from './marcmap.js';

export function rec2alephseq(emitter: EventEmitter) : void {
    emitter.on("record", (rec: string[][]) => {
        let id = marcmap(rec,"001",{});
        console.log(`${id} FMT   L BK`);
        for (let i = 0 ; i < rec.length ; i++) {
            let tag  = rec[i]![0];
            let ind1 = rec[i]![1];
            let ind2 = rec[i]![2];
            let sf = "";

            for (let j = 3; j < rec[i]!.length ; j += 2) {
                let code = rec[i]![j];
                let val  = rec[i]![j+1];
                if (tag!.match(/^LDR|00./g)) {
                    sf += `${val}`;
                }
                else {
                    sf += `\$\$${code}${val}`;
                }
            }

            console.log(`${id} ${tag}${ind1}${ind2} L ${sf}`);
        }
    });
}