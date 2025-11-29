import { Transform } from 'stream';

export function transform(opts) {
    return new Transform({
        objectMode: true,
        transform(data, encoding, callback) {
            data['id'] = "brol";
            data['record'] = [];
            callback(null,data);
        }
    });
}
