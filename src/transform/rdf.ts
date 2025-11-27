import { Transform } from "stream";

export default function transform(_opts: any) {
    return new Transform({
        objectMode: true,
        transform(data: any, encoding, callback) {
            let quads : any[] = [];

            data['quads'] = quads;
            callback(null,data);
        }
    });
}