import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform() : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            const output = JSON.stringify(data);
            logger.debug(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}