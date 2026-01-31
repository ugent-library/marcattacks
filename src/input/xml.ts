import { Transform, type TransformCallback } from 'stream';
import sax from 'sax';
import log4js from 'log4js';

const logger = log4js.getLogger();

type FieldAttribute = { [key: string]: string; } | { [key: string]: sax.QualifiedAttribute; };
type SubfieldAttribute = { [key: string]: string; };

export async function transform(_opts: any): Promise<Transform> {
    let record: string[][] = [];
    let subfield: string[] = [];
    let attrib: FieldAttribute = {};
    let sattrib: SubfieldAttribute = {};
    let text: string = '';
    let hasError = false;

    const parser = sax.createStream(true);

    const transformStream = new Transform({
        objectMode: true,

        transform(chunk: any, _encoding: string, callback: TransformCallback) {
            if (hasError) return callback();
            parser.write(chunk);
            callback();
        },

        flush(callback: TransformCallback) {
            if (hasError) return callback();
            parser.end();
            callback();
        }
    });

    parser.on('opentag', (node: sax.Tag) => {
        const localName = node.name.replaceAll(/^\w+:/g, '');
        if (localName === 'controlfield' || localName === 'datafield') {
            attrib = node.attributes;
        } else if (localName === 'subfield') {
            sattrib = node.attributes;
        }
        text = '';
    });

    parser.on('text', (t: string) => {
        text += t;
    });

    parser.on('closetag', (tag: string) => {
        const localName = tag.replaceAll(/^\w+:/g, '');
        
        if (localName === 'leader') {
            record.push(['LDR', ' ', ' ', '_', text]);
        } else if (localName === 'controlfield') {
            record.push([attrib.tag as string, ' ', ' ', '_', text]);
        } else if (localName === 'datafield') {
            record.push([attrib.tag as string, attrib.ind1 as string, attrib.ind2 as string, ...subfield]);
            subfield = [];
        } else if (localName === 'subfield') {
            subfield.push(sattrib.code as string, text);
        }

        if (localName === 'record') {
            // Push the completed record object down the pipeline
            transformStream.push({ record });
            record = [];
        }
    });

    parser.on("error", (err) => {
        hasError = true;
        logger.debug(err);
        logger.error("parser error", err.message);
        transformStream.destroy(err);
        throw err;
    });

    return transformStream;
}