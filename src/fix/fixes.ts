// A subset of Catmandu Fix functions, ported to JS on top of the Path engine.
// Each fix is `(args) => (data) => data`, mirroring how Catmandu builds a
// fixer from a path plus arguments. Semantics follow Catmandu::Fix::* exactly
// (see the conformance tests, which are ported from Catmandu's own t/).

import { Path, isArray } from './path.js';
import { marcmap } from '../marcmap.js';
import { randomUUID } from 'node:crypto';
import { REJECT } from './signal.js';

type Data = any;
type Fixer = (data: Data) => Data;
type FixBuilder = (args: string[]) => Fixer;

function clone<T>(v: T): T {
    return v === undefined ? v : structuredClone(v);
}

// Catmandu is_value: a defined scalar (string or number), not a ref.
function isValue(v: Data): boolean {
    return typeof v === 'string' || typeof v === 'number';
}

// Perl s/search/replace/g with $1 / ${1} interpolation -> JS replace.
function substituter(search: string, replace: string): (v: Data) => Data {
    const re = new RegExp(search, 'g');
    const js = replace.replace(/\$\{(\d+)\}/g, '$$$1'); // ${1} -> $1
    return (v: Data) => String(v).replace(re, js);
}

export const FIXES: Record<string, FixBuilder> = {
    // --- field creation / movement ---
    add_field: ([path, value]) => new Path(path!).creator(value ?? null),

    set_field: ([path, value]) => new Path(path!).setter(value ?? null),

    remove_field: ([path]) => new Path(path!).deleter(),

    copy_field: ([oldPath, newPath]) => {
        const getter = new Path(oldPath!).getter();
        const creator = new Path(newPath!).creator(undefined);
        return (data: Data) => {
            for (const v of getter(data).map(clone)) data = creator(data, v);
            return data;
        };
    },

    move_field: ([oldPath, newPath]) => {
        const getter = new Path(oldPath!).getter();
        const creator = new Path(newPath!).creator(undefined);
        const deleter = new Path(oldPath!).deleter();
        return (data: Data) => {
            for (const v of getter(data).map(clone)) data = creator(data, v);
            return deleter(data);
        };
    },

    // --- string transforms (only act on existing string values) ---
    upcase: ([path]) => new Path(path!).updater((v) => v.toUpperCase(), 'string'),
    downcase: ([path]) => new Path(path!).updater((v) => v.toLowerCase(), 'string'),
    capitalize: ([path]) => new Path(path!).updater((v) => {
        const s = v.toLowerCase();
        return s.charAt(0).toUpperCase() + s.slice(1);
    }, 'string'),

    trim: ([path, mode = 'whitespace']) => {
        const cb = mode === 'nonword'
            ? (v: string) => v.replace(/^\W+/u, '').replace(/\W+$/u, '')
            : mode === 'diacritics'
                ? (v: string) => v.normalize('NFKD').replace(/\p{Mn}/gu, '')
                : (v: string) => v.replace(/^\s+/u, '').replace(/\s+$/u, '');
        return new Path(path!).updater(cb, 'string');
    },

    prepend: ([path, str = '']) => new Path(path!).updater((v) => str + v, 'string'),
    append: ([path, str = '']) => new Path(path!).updater((v) => v + str, 'string'),

    replace_all: ([path, search, replace = '']) =>
        new Path(path!).updater(substituter(search!, replace), 'value'),

    // --- array <-> string ---
    join_field: ([path, sep = ' ']) =>
        new Path(path!).updater((v) => v.filter(isValue).join(sep), 'array'),

    split_field: ([path, sep = ' ']) => {
        const re = new RegExp(sep);
        return new Path(path!).updater((v) => String(v).split(re), 'value');
    },

    // --- paste: concatenate several fields/literals into one ---
    paste: (args) => {
        const target = args[0]!;
        let joinChar = ' ';
        const parts: Array<{ literal: string } | { getter: (d: Data) => Data[] }> = [];
        for (let i = 1; i < args.length; i++) {
            const a = args[i]!;
            if (a === 'join_char') { joinChar = args[i + 1] ?? ' '; break; }
            if (a.startsWith('~')) parts.push({ literal: a.slice(1) });
            else parts.push({ getter: new Path(a).getter() });
        }
        const creator = new Path(target).creator(undefined);
        return (data: Data) => {
            const vals: Data[] = [];
            for (const p of parts) {
                if ('literal' in p) vals.push(p.literal);
                else for (const v of p.getter(data)) if (isValue(v)) vals.push(v);
            }
            return creator(data, vals.join(joinChar));
        };
    },

    // --- MARC: reuse marcattacks' existing marcmap() for field extraction ---
    // marc_map(MARC_PATH, JSON_PATH, split:0|1, join:Str, value:Str)
    // Mirrors Catmandu::Fix::marc_map's emit loop: the result is a list of
    // values and each value is created at JSON_PATH (so a $append/numeric
    // target appends one element per value). Supports a /from-to substring.
    marc_map: (args) => {
        const marcPath0 = args[0]!;
        const jsonPath = args[1]!;
        const opts: Record<string, string | undefined> = {};
        for (let i = 2; i < args.length; i += 2) opts[args[i]!] = args[i + 1];
        const split = opts.split === '1' || opts.split === 'true';
        const joinChar = opts.join ?? '';   // Catmandu marc_map default join is empty
        const value = opts.value;

        // substring suffix, e.g. 008/35-37
        let marcPath = marcPath0;
        let from: number | undefined;
        let len = 1;
        const sub = /^(.*)\/(\d+)(?:-(\d+))?$/.exec(marcPath0);
        if (sub) { marcPath = sub[1]!; from = Number(sub[2]); if (sub[3] !== undefined) len = Number(sub[3]) - from + 1; }

        const p = new Path(jsonPath);
        const lastKey = p.keys.length ? p.keys[p.keys.length - 1]! : '';
        const forceArray = /^(\$.*|[0-9]+)$/.test(lastKey);
        const creator = p.creator(undefined);

        return (data: Data) => {
            const rec = data?.record;
            if (!isArray(rec)) return data;
            // marcmap() yields one entry per tag-matched field; an empty string
            // means the field matched the tag but had no matching subfield.
            // Catmandu drops those, so filter them out.
            let vals = marcmap(rec, marcPath, { join_char: joinChar }).filter((v) => v !== '');
            if (from !== undefined) {
                vals = vals.map((v) => (v.length > from! ? v.substr(from!, len) : undefined))
                    .filter((v): v is string => v !== undefined);
            }
            if (!vals.length) return data;

            let result: Data[];
            if (value !== undefined) result = [value];                 // value:Str -> constant when field exists
            else if (forceArray) result = vals;                        // append/numeric target: one element per value
            else if (split) result = [vals];                           // split: a single array value
            else result = [vals.join(joinChar)];                       // default: one joined string

            for (const v of result) data = creator(data, v);
            return data;
        };
    },

    // genid(PATH): create / overwrite each terminal slot with a fresh id.
    // A fresh id is generated per slot (so PATH.* yields a distinct id each).
    genid: ([path]) => new Path(path!).creator(() => `genid:${randomUUID()}`),

    // marc_remove(TAG): drop all MARC fields with the given tag.
    marc_remove: ([tag]) => (data: Data) => {
        if (data && isArray(data.record)) data.record = data.record.filter((r: string[]) => r[0] !== tag);
        return data;
    },

    // reject(): drop the current record / field (used inside marc_each etc.)
    reject: () => () => REJECT,

    // --- misc ---
    nothing: () => (data: Data) => data,
};

export function buildFix(name: string, args: string[]): Fixer {
    const builder = FIXES[name];
    if (!builder) throw new Error(`unknown fix: ${name}`);
    return builder(args);
}
