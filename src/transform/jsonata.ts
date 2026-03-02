import { Transform } from "stream";
import jsonata from "jsonata";
import fs from "fs";
import { marcmap, marctag, marcind, marcsubfields } from '../marcmap.js';
import { parseStream } from '../util/tsv_parse.js';
import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(opts: { fix: string, lookup: string }) : Promise<Transform> {
    let query : string; 

    let lookup : Record<string,string> = {};
    
    if (opts.lookup) {
        lookup = await loadLookup(opts.lookup);
    }

    logger.info(lookup);

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            try {
                if (!query) {
                    if (opts.fix) {
                        if (fs.existsSync(opts.fix)) {
                            query = fs.readFileSync(opts.fix,{ encoding: 'utf-8'});
                        }
                        else {
                            throw Error(`no such file ${opts.fix}`);
                        }
                    }
                    else {
                        query = '$';
                    }

                    logger.debug(query);
                }
                const expression = jsonata(query);
                expression.registerFunction('marcmap', (code) => {
                    return marcmap(data['record'],code,{});
                });
                expression.registerFunction('marctag', (row) => {
                    return marctag(row);
                });
                expression.registerFunction('marcind', (row) => {
                    return marcind(row);
                });
                expression.registerFunction('marcsubfields', (row,regex) => {
                    return marcsubfields(row, new RegExp(regex));
                });
                expression.registerFunction('marcrecord', () => {
                    return data['record'];
                });
                expression.registerFunction('asmarc', (data) => {
                    return { "record": data};
                });
                expression.registerFunction('genid', () => {
                    return genid();
                });
                expression.registerFunction('lookup', (key) => {
                    return lookup[key];
                });
                data = await expression.evaluate(data);
                callback(null,data);
            }
            catch (err) {
                logger.info(err);
                callback(err as Error);
            }
        }
    });
}

function genid() : string {
    return `genid:${uuidv4()}`;
}

async function loadLookup(path: string) : Promise<Record<string,string>> {
    let lookup : Record<string, string> = {};

    const records = await parseStream(fs.createReadStream(path));

    for (const row of records) {
        const keys = Object.keys(row).sort();
        if (keys && keys.length == 2 && keys[0] && keys[1]) {
            const A = row[keys[0]];
            const B = row[keys[1]];
            if (A && B) {
                lookup[A] = B;
            }
        }
    }

    return lookup;
}