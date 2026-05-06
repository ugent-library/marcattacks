import { Transform } from "stream";
import { marcmap } from "../marcmap.js";

/**
 * Transform to a stream of marc-001 field ids
 */
export async function transform(_opts: any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                callback(null);
                return;
            }

            let id = marcmap(rec,"001",{});

            if (id.length == 1) {
                callback(null,{id: id[0]});
            }
        }
    });
}