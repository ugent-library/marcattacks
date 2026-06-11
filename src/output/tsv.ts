import { Transform } from 'stream';
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface OutputTSVOptions {
    header?: "yes" | "no";
    delimiter?: string;
}

export async function transform(opts: OutputTSVOptions = {}) : Promise<Transform> {
    // provide default empty object so callers can omit options
    let sortedKeys : string[];
    let delimiter : string = opts.delimiter ?
        opts.delimiter.replace("\\t","\t") : "\t";

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
                    output += sortedKeys.join(delimiter) + "\n";
                }
            }

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
                    // Neutralise the delimiter and line breaks so a value can't
                    // corrupt the row/column structure (TSV has no quoting).
                    fields.push(String(val).replace(/[\t\r\n]/g, " "));
                }
            });

            output += fields.join(delimiter) + "\n";

            logger.trace(`adding ${output.length} bytes`);
            callback(null,output);
        }
    });
}