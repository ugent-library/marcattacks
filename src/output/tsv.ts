import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface OutputTSVOptions {
    header?: "yes" | "no";
}

export async function transform(opts: OutputTSVOptions = {}) : Promise<Transform> {
    // provide default empty object so callers can omit options
    let sortedKeys : string[];

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            if (Object.keys(data).length == 0) {
                logger.debug('skipped empty record');
                callback();
                return;
            }
            
            let output = "";
            let fields : string[] = [];

            if (! sortedKeys ) {
                sortedKeys = Object.keys(data).sort();
                if (opts?.header && opts.header === "no") {
                    // ok skipped header
                }
                else {
                    output += sortedKeys.join("\t") + "\n";
                }
            }

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

            output += fields.join("\t") + "\n";

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}