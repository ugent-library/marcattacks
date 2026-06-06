import { Transform } from 'stream';
import fs from 'fs';
import log4js from 'log4js';
import { compileFix } from '../fix/index.js';

const logger = log4js.getLogger();

/**
 * Apply a Catmandu Fix script to each record.
 *
 *   marcattacks --map fix --param fix=./my.fix ...
 *
 * `fix` may be a path to a Fix file or an inline Fix script. The script is
 * parsed and compiled once; the compiled chain runs per record.
 */
export async function transform(opts: { fix?: string }): Promise<Transform> {
    let src = opts.fix ?? '';
    if (src && fs.existsSync(src)) {
        src = fs.readFileSync(src, { encoding: 'utf-8' });
    }
    const fix = compileFix(src);

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            try {
                callback(null, fix(data));
            } catch (err: any) {
                logger.error('fix error', err.message);
                callback(err);
            }
        }
    });
}
