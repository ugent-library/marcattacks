import type { ReadStream } from 'fs';
import { Readable } from 'stream';
import sax from 'sax';
import log4js from 'log4js';

type FieldAttribute = { [key: string]: string; } | { [key: string]: sax.QualifiedAttribute; };
type SubfieldAttribute = { [key: string]: string; };
type MARCType = 'leader' | 'control' | 'field' | 'subfield' | undefined;

export function processStream(stream: ReadStream, logger: log4js.Logger) : Readable {
    const readableStream = new Readable({
        read() {} ,
        objectMode: true 
    });

    const parser = sax.createStream(true);

    let record : string[][] = [];
    let subfield : string[] = [];
    let attrib : FieldAttribute = {};
    let sattrib : SubfieldAttribute = {};
    let type : MARCType;
    let text : string = '';
        
    parser.on('opentag', (node: sax.Tag) => {
        if (node.name === 'marc:collection') {
            // Start collection...
        }
        else if (node.name === 'marc:record') {
            // Start record...
        }
        else if (node.name === 'marc:leader') {
            type = 'leader';
        }
        else if (node.name == 'marc:controlfield') {
            type = 'control';
            attrib = node.attributes
        }
        else if (node.name === 'marc:datafield') {
            attrib = node.attributes;
        }
        else if (node.name === 'marc:subfield') {
            sattrib = node.attributes;
        }
        else {
            logger.error(`unknown tag: ${node.name}`);
        }

        text = '';
    });

    parser.on('text', (t: string) => {
        text += t;
    });

    parser.on('closetag', (tag: string) => {
        if (tag === 'marc:leader') {
            record.push(['LDR',' ',' ','_',text]);
        }
        else if (tag == 'marc:controlfield') {
            let tag = attrib.tag as string;
            record.push([tag,' ',' ','_',text]);
        }
        else if (tag === 'marc:datafield') {
            let tag  = attrib.tag as string;
            let ind1 = attrib.ind1 as string;
            let ind2 = attrib.ind2 as string;
            record.push([tag,ind1,ind2].concat(subfield));
            subfield = [];
        }
        else if (tag === 'marc:subfield') {
            let code = sattrib.code as string;
            subfield = subfield.concat([code,text]);
        }
        if (tag === 'marc:record') {
            readableStream.push({ record });
            record = [];
        }
    }); 

    parser.on("error", (err) => {
        logger.error("Parser error:", err);
    });

    parser.on('end', () => {
        readableStream.push(null);
    });

    stream.pipe(parser);

    return readableStream;
}   