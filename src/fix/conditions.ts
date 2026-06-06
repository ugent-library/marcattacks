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
        case 'marc_match': {
            // marc_match(MARC_PATH, REGEX): true if any matching subfield value
            // matches REGEX. Tag may be *** (any). MARC_PATH = tag + subcodes.
            const mp = args[0]!;
            const tag = mp.slice(0, 3);
            const subs = mp.slice(3).replace(/\$/g, '');
            const re = new RegExp(arg!);
            return (d) => {
                const rec = d?.record;
                if (!Array.isArray(rec)) return false;
                for (const row of rec) {
                    if (tag !== '***' && row[0] !== tag) continue;
                    for (let i = 3; i < row.length; i += 2) {
                        if ((subs === '' || subs.includes(row[i])) && re.test(String(row[i + 1]))) return true;
                    }
                }
                return false;
            };
        }
        case 'marc_has':
            return (d) => {
                const rec = d?.record; const tag = args[0]!;
                return Array.isArray(rec) && rec.some((row: string[]) => row[0] === tag);
            };
        default:
            throw new Error(`unknown condition: ${name}`);
    }
}
