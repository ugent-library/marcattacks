import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

// The do nothing transformer: generates nothing
export async function transform(_opts: any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            callback();
        }
    });
}