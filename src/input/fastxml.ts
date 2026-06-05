import { Transform, type TransformCallback } from 'stream';
import { StringDecoder } from 'node:string_decoder';
import { CLEAN } from '../util/marc_record.js';
import log4js from 'log4js';

const logger = log4js.getLogger();

// A fast, flat-memory MARCXML reader.
//
// Instead of running the whole document through a character-by-character SAX
// state machine (see ./xml.ts), this splits the byte stream into individual
// <record>...</record> blocks and scans each block with a few targeted
// regexes. Only one record is ever buffered, so memory stays flat regardless
// of input size, and throughput is several times higher than the SAX reader.
//
// MARCXML is a rigidly constrained subset of XML (LOC MARC21slim): no CDATA,
// no comments, no nested elements beyond record/leader/controlfield/datafield/
// subfield. Attributes may be single- or double-quoted. This scanner targets
// exactly that grammar; for arbitrary XML use the SAX-based `xml` reader.

const OPEN = /<(?:[\w.-]+:)?record(?:\s[^>]*)?>/g;
const CLOSE = /<\/(?:[\w.-]+:)?record\s*>/g;
// leader / controlfield / datafield, with the element body captured in group 3
const FIELD = /<(?:[\w.-]+:)?(leader|controlfield|datafield)((?:\s[^>]*)?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>)/g;
const SUBF = /<(?:[\w.-]+:)?subfield((?:\s[^>]*)?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?subfield\s*>)/g;
const ATTR = /([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const CONTROL = /[\x00-\x1F\x7F]/g;
const ENTITY = /&(#x?[0-9a-fA-F]+|\w+);/g;

const NAMED: { [k: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
    if (s.indexOf('&') === -1) return s;
    return s.replace(ENTITY, (m, e) => {
        if (e[0] === '#') {
            const cp = (e[1] === 'x' || e[1] === 'X')
                ? parseInt(e.slice(2), 16)
                : parseInt(e.slice(1), 10);
            return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
        }
        return e in NAMED ? NAMED[e] as string : m;
    });
}

// element text: decode entities and strip control characters (matches xml.ts)
function decodeText(s: string): string {
    return decodeEntities(s).replaceAll(CONTROL, '');
}

// attribute value: decode entities only (xml.ts does not strip attributes)
function attrs(s: string): { [k: string]: string } {
    const o: { [k: string]: string } = {};
    ATTR.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR.exec(s))) o[a[1] as string] = decodeEntities(a[2] ?? a[3] ?? '');
    return o;
}

function recordToFields(xml: string): string[][] {
    const fields: string[][] = [];
    FIELD.lastIndex = 0;
    let f: RegExpExecArray | null;
    while ((f = FIELD.exec(xml))) {
        const kind = f[1];
        const body = f[3] ?? '';
        if (kind === 'leader') {
            fields.push(['LDR', ' ', ' ', '_', decodeText(body)]);
        } else if (kind === 'controlfield') {
            fields.push([attrs(f[2] ?? '').tag as string, ' ', ' ', '_', decodeText(body)]);
        } else {
            const at = attrs(f[2] ?? '');
            const row: string[] = [at.tag as string, at.ind1 ?? ' ', at.ind2 ?? ' '];
            SUBF.lastIndex = 0;
            let s: RegExpExecArray | null;
            while ((s = SUBF.exec(body))) {
                row.push(attrs(s[1] ?? '').code as string, decodeText(s[2] ?? ''));
            }
            fields.push(row);
        }
    }
    return fields;
}

export async function transform(_opts: any): Promise<Transform> {
    let buf = '';
    const decoder = new StringDecoder('utf8');

    function drain(stream: Transform): void {
        let pos = 0;
        let keepFrom = -1;
        while (true) {
            OPEN.lastIndex = pos;
            const o = OPEN.exec(buf);
            if (!o) break;                                  // no (more) open tags
            CLOSE.lastIndex = o.index + o[0].length;
            const c = CLOSE.exec(buf);
            if (!c) { keepFrom = o.index; break; }          // record not yet complete
            const end = c.index + c[0].length;
            // values are stripped of control chars during parsing -> mark clean
            stream.push({ record: recordToFields(buf.slice(o.index, end)), [CLEAN]: true });
            pos = end;
        }
        // keep a pending partial record, else drop consumed text but retain a
        // small tail so an open tag spanning the next chunk is not lost
        buf = keepFrom >= 0 ? buf.slice(keepFrom)
            : pos > 0 ? buf.slice(pos)
            : buf.length > 64 ? buf.slice(-64) : buf;
    }

    const transformStream = new Transform({
        objectMode: true,

        transform(chunk: any, _encoding: string, callback: TransformCallback) {
            try {
                buf += decoder.write(chunk);
                drain(this);
                callback();
            } catch (err: any) {
                logger.error('fastxml parse error', err.message);
                callback(err);
            }
        },

        flush(callback: TransformCallback) {
            try {
                buf += decoder.end();
                drain(this);
                callback();
            } catch (err: any) {
                logger.error('fastxml parse error', err.message);
                callback(err);
            }
        },
    });

    return transformStream;
}
