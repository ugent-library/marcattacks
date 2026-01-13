import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform() : Promise<Transform> {
    let isFirst = true;
    let hasClosed = false;

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let output = "";

            if (isFirst) {
                output += "[";
            }
            else {
                output += ',';
            }

            output += JSON.stringify(data);

            isFirst = false;

            logger.debug(`adding ${output.length} bytes`);
            callback(null,output);
        },
        flush(callback) {
            // Push the closing bracket to the buffer
            if (!isFirst && !hasClosed) {
                this.push("]");
                hasClosed = true;
            }
            callback();
        },
        destroy(err, callback) {
            callback(err);
        }
    });
}
