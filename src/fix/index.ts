import { parseFix } from './parser.js';
import { buildFix } from './fixes.js';

export { Path } from './path.js';
export { FIXES, buildFix } from './fixes.js';
export { parseFix } from './parser.js';

/**
 * Compile a Catmandu Fix script into a record -> record function.
 * The whole script is parsed and its fixers built once; the returned function
 * just runs the chain, so it is cheap to apply per record.
 */
export function compileFix(src: string): (data: any) => any {
    const fixers = parseFix(src).map((c) => buildFix(c.name, c.args));
    return (data: any) => {
        for (const f of fixers) data = f(data);
        return data;
    };
}
