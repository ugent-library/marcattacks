// Catmandu Fix binds: the `do BIND(...) ... end` construct that wraps a block
// of fixes and controls how they are applied. A subset — `list` (the common
// one, for iterating an array) and `identity`.
//
// Bind contract (see Catmandu::Fix::Bind): unit(data) seeds the bound value,
// then the wrapped block is applied to it. `do` returns the original record;
// `doset` returns the bound result.

import { Path, isHash, isArray } from './path.js';

type Data = any;
type Runner = (data: Data) => Data;

function parseOpts(args: string[]): Record<string, string> {
    const o: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) if (args[i] !== undefined) o[args[i]!] = args[i + 1] ?? '';
    return o;
}

export function buildBind(name: string, args: string[], body: Runner, doset: boolean): Runner {
    const opts = parseOpts(args);

    if (name === 'list') {
        const pathGet = opts.path !== undefined ? new Path(opts.path).getter() : undefined;
        const varName = opts.var;
        return (data: Data) => {
            const root = data;
            const mvar = pathGet ? pathGet(data)[0] : data;
            let result: Data = mvar;
            if (isHash(mvar)) {
                result = body(mvar);
            } else if (isArray(mvar)) {
                for (let i = 0; i < mvar.length; i++) {
                    if (varName !== undefined) {
                        root[varName] = mvar[i];
                        body(root);
                        delete root[varName];
                    } else {
                        mvar[i] = body(mvar[i]);
                    }
                }
                result = mvar;
            } else {
                result = []; // zero
            }
            return doset ? result : root;
        };
    }

    // identity (and any unknown bind): just run the block on the record
    return (data: Data) => {
        const r = body(data);
        return doset ? r : data;
    };
}
