// A small parser for Catmandu Fix scripts. Handles the statement form that
// covers the vast majority of real mappings:
//
//   # a comment
//   copy_field(foo.bar, bar.foo)
//   add_field(type, 'Book')
//   paste(my.string, a, b, join_char:", ")
//
// Tokens follow Catmandu::Fix::Parser: bare strings, single/double quoted
// strings (quotes stripped), and `, : =>` as argument separators. Conditionals
// and binds (if/unless/do ... end) are not yet supported.

export interface FixCall { name: string; args: string[]; }

export function parseFix(src: string): FixCall[] {
    const calls: FixCall[] = [];
    let i = 0;
    const n = src.length;

    const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

    function skipTrivia() {
        while (i < n) {
            const c = src[i]!;
            if (isSpace(c) || c === ';' || c === ',') { i++; continue; }
            if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
            break;
        }
    }

    // Matches Catmandu::Fix::Parser: single quotes keep backslashes literally
    // except \' -> ' ; double quotes process \n \r \t \b \f \\ \" \uXXXX.
    function readQuoted(q: string): string {
        i++; // opening quote
        let out = '';
        while (i < n) {
            const c = src[i]!;
            if (c === q) { i++; break; }
            if (c === '\\') {
                const nx = src[i + 1] ?? '';
                if (q === "'") {
                    if (nx === "'") { out += "'"; i += 2; } else { out += '\\'; i += 1; }
                } else {
                    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\' };
                    if (nx === 'u' && /[0-9A-Fa-f]{4}/.test(src.slice(i + 2, i + 6))) {
                        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6;
                    } else if (nx in map) { out += map[nx]; i += 2; }
                    else { out += '\\'; i += 1; } // unknown escape: keep backslash
                }
                continue;
            }
            out += c; i++;
        }
        return out;
    }

    function readArgs(): string[] {
        const args: string[] = [];
        i++; // opening (
        for (;;) {
            // skip separators / whitespace within the arg list
            while (i < n && (isSpace(src[i]!) || src[i] === ',' || src[i] === ':')) i++;
            if (i >= n || src[i] === ')') { i++; break; }
            const c = src[i]!;
            if (c === "'" || c === '"') { args.push(readQuoted(c)); continue; }
            // bare string: up to a separator / paren / quote
            let s = '';
            while (i < n && !/[\s,:()"']/.test(src[i]!) && !(src[i] === '=' && src[i + 1] === '>')) {
                s += src[i]; i++;
            }
            if (src[i] === '=' && src[i + 1] === '>') i += 2; // treat => as a separator
            args.push(s);
        }
        return args;
    }

    while (i < n) {
        skipTrivia();
        if (i >= n) break;
        // read a fix name
        let name = '';
        while (i < n && /[A-Za-z0-9_.]/.test(src[i]!)) { name += src[i]; i++; }
        if (!name) { i++; continue; }
        while (i < n && isSpace(src[i]!)) i++;
        if (src[i] === '(') {
            calls.push({ name, args: readArgs() });
        } else {
            // a bareword with no args (e.g. a condition keyword) — skip for now
        }
    }

    return calls;
}
