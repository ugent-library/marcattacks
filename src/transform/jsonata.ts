import { Transform } from "stream";
import jsonata from "jsonata";
import fs from "fs";
import { marcmap } from '../marcmap.js';
import { v4 as uuidv4 } from 'uuid';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(param: any) : Promise<Transform> {
    let query = param.fix;

    if (param.fix && fs.existsSync(param.fix)) {
        query = fs.readFileSync(param.fix,{ encoding: 'utf-8'});
    }

    if (!param.fix) {
        query = '$';
    }

    logger.debug(query);
    
    return new Transform({
        objectMode: true,
        async transform(data: any, _encoding, callback) {
            const expression = jsonata(query);
            expression.registerFunction('marcmap', (code) => {
                return marcmap(data['record'],code,{});
            });
            expression.registerFunction('genid', () => {
                return genid();
            });
            data = await expression.evaluate(data);
            callback(null,data);
        }
    });
}

function genid() : string {
    return `genid:${uuidv4()}`;
}