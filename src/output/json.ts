import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(_opts:any) : Promise<Transform> {
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
            // On empty input no chunk was ever written, so close the array that
            // was never opened: emit "[]" rather than a zero-byte file, which is
            // invalid JSON for any consumer that parses it.
            this.push(isFirst ? "[]" : "]");
            callback();
        }
    });
}
