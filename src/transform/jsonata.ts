import { Transform } from "stream";
import jsonata from "jsonata";
import fs from "fs";
import { marcmap , marcsubfields, marcForEachTag } from '../marcmap.js';
import { v4 as uuidv4 } from 'uuid';

export async function transform(q: string) : Promise<Transform> {
    let query = q;

    if (q && fs.existsSync(q)) {
        query = fs.readFileSync(q,{ encoding: 'utf-8'});
    }

    if (!q) {
        query = '$';
    }

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const expression = jsonata(query);
            expression.registerFunction('marcmap', (code) => {
                return marcmap(data['record'],code,{});
            });
<<<<<<< HEAD:src/transform/json.ts
            expression.registerFunction('strip', (value) => {
                return value ? strip(value) : value;
            });
=======
>>>>>>> 69f2223e4706e5fb1e262dacdaf64f78d38239e2:src/transform/jsonata.ts
            expression.registerFunction('genid', () => {
                return genid();
            });
            data = await expression.evaluate(data);
            callback(null,data);
        }
    });
}

function genid() : string {
    return `genid:${uuidv4()}`;
}