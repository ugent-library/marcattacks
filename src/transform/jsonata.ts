import Stream, { Transform } from "stream";
import jsonata from "jsonata";
import fs from "fs";
import { marcmap, marctag, marcind, marcsubfields } from '../marcmap.js';
import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(param: any) : Promise<Transform> {
    let query : string; 

    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding: BufferEncoding, callback: Stream.TransformCallback) {
            try {
                if (!query) {
                    if (param.fix) {
                        if (fs.existsSync(param.fix)) {
                            query = fs.readFileSync(param.fix,{ encoding: 'utf-8'});
                        }
                        else {
                            throw Error(`no such file ${param.fix}`);
                        }
                    }
                    else {
                        query = '$';
                    }

                    logger.debug(query);
                }
                const expression = jsonata(query);
                expression.registerFunction('marcmap', (code: string) => {
                    return marcmap(data['record'],code,{});
                });
                expression.registerFunction('marctag', (row: string[]) => {
                    return marctag(row);
                });
                expression.registerFunction('marcind', (row: string[]) => {
                    return marcind(row);
                });
                expression.registerFunction('marcsubfields', (row: string[],regex: string) => {
                    return marcsubfields(row, new RegExp(regex));
                });
                expression.registerFunction('marcrecord', () => {
                    return data['record'];
                });
                expression.registerFunction('asmarc', (data: string[][]) => {
                    return { "record": data};
                });
                expression.registerFunction('genid', () => {
                    return genid();
                });
                data = await expression.evaluate(data);
                callback(null,data);
            }
            catch (err: any) {
                logger.info(err);
                callback(err as Error);
            }
        }
    });
}

function genid() : string {
    return `genid:${uuidv4()}`;
}