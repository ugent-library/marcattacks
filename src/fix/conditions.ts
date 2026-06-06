// Catmandu Fix conditions, used by if/unless blocks. Each returns a predicate
// over the record. (A subset — the common ones.)

import { Path } from './path.js';

type Data = any;
type Cond = (data: Data) => boolean;

export function buildCondition(name: string, args: string[]): Cond {
    const path = args[0] !== undefined ? new Path(args[0]).getter() : () => [];
    const arg = args[1];

    switch (name) {
        case 'exists':
            return (d) => path(d).length > 0;
        case 'all_match': {
            const re = new RegExp(arg!);
            return (d) => { const v = path(d); return v.length > 0 && v.every((x) => re.test(String(x))); };
        }
        case 'any_match': {
            const re = new RegExp(arg!);
            return (d) => path(d).some((x) => re.test(String(x)));
        }
        case 'all_equal':
            return (d) => { const v = path(d); return v.length > 0 && v.every((x) => String(x) === arg); };
        case 'any_equal':
            return (d) => path(d).some((x) => String(x) === arg);
        case 'is_string':
            return (d) => { const v = path(d); return v.length > 0 && v.every((x) => typeof x === 'string'); };
        case 'is_array':
            return (d) => { const v = path(d); return v.length > 0 && v.every((x) => Array.isArray(x)); };
        default:
            throw new Error(`unknown condition: ${name}`);
    }
}
