import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_param:any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            if (Object.keys(data).length == 0) {
                logger.debug('skipped empty record');
                callback();
                return;
            }
            
            const output = JSON.stringify(data) + "\n";
            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}