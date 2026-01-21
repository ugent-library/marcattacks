import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_param:any) : Promise<Transform> {
    let isFirst = true;

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            if (Object.keys(data).length == 0) {
                logger.debug('skipped empty record');
                callback();
                return;
            }
            
            let output = "";

            if (isFirst) {
                output += "[";
            }
            else {
                output += ',';
            }

            output += JSON.stringify(data);

            isFirst = false;

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        },
        flush(callback) {
            logger.debug('flush reached');
            if (!isFirst) {
                this.push("]");
            }
            callback();
        }
    });
}
