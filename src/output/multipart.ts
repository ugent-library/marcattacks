import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface OutputMultipartOptions {
    header?: string;
    delimiter?: string;
    noEndDelimiter?: string;
}

export async function transform(opts: OutputMultipartOptions = {}) : Promise<Transform> {
    let header : string = opts.header ? opts.header :
        "Content-Type: multipart/mixed; boundary=\"marcattacks\"";
    let delimiter : string = opts.delimiter ? opts.delimiter : "--marcattacks";
    let noEndDelimiter : boolean = opts.noEndDelimiter === 'true' ? true : false;

    let isFirst = true;

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let output = "";

            if (isFirst) {
                output += header + "\n\n";
                isFirst = false;
            }
            else {
                output += delimiter + "\n";
            }

            let fields : string[] = [];

            let sortedKeys = Object.keys(data).sort();

            sortedKeys.forEach( key => {
                if (Array.isArray(data[key])) {
                    fields.push(`ARRAY[${data[key].length}]`);
                }
                else if (typeof data[key] === 'object') {
                    fields.push(`HASH[${Object.keys(data[key]).length}]`);
                }
                else {
                    fields.push(data[key]);
                }
            });

            output += fields.join(" ") + "\n";

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        },
        flush(callback) {
            logger.debug('flush reached');
            if (!isFirst && !noEndDelimiter) {
                let output = delimiter + "--\n";
                logger.trace(`adding ${output.length} bytes`);
                this.push(output);
            }
            callback();
        }
    });
}