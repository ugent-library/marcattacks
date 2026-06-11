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
                const val = data[key];
                if (val === null || val === undefined) {
                    fields.push("");
                }
                else if (Array.isArray(val)) {
                    fields.push(`ARRAY[${val.length}]`);
                }
                else if (typeof val === 'object') {
                    fields.push(`HASH[${Object.keys(val).length}]`);
                }
                else {
                    fields.push(val);
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