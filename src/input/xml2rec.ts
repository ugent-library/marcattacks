import { Readable } from 'stream';
import sax from 'sax';
import log4js from 'log4js';

type FieldAttribute = { [key: string]: string; } | { [key: string]: sax.QualifiedAttribute; };
type SubfieldAttribute = { [key: string]: string; };
type MARCType = 'leader' | 'control' | 'field' | 'subfield' | undefined;

const logger = log4js.getLogger();

export function stream2readable(stream: Readable) : Readable {
    let recordNum = 0;

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
        const localName = node.name.replaceAll(/^\w+:/g,'');

        if (localName === 'collection') {
            // Start collection...
        }
        else if (localName === 'record') {
            // Start record...
        }
        else if (localName === 'leader') {
            type = 'leader';
        }
        else if (localName == 'controlfield') {
            type = 'control';
            attrib = node.attributes
        }
        else if (localName === 'datafield') {
            attrib = node.attributes;
        }
        else if (localName === 'subfield') {
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
        const localName = tag.replaceAll(/^\w+:/g,'');
        if (localName === 'leader') {
            record.push(['LDR',' ',' ','_',text]);
        }
        else if (localName == 'controlfield') {
            let tag = attrib.tag as string;
            record.push([tag,' ',' ','_',text]);
        }
        else if (localName === 'datafield') {
            let tag  = attrib.tag as string;
            let ind1 = attrib.ind1 as string;
            let ind2 = attrib.ind2 as string;
            record.push([tag,ind1,ind2].concat(subfield));
            subfield = [];
        }
        else if (localName === 'subfield') {
            let code = sattrib.code as string;
            subfield = subfield.concat([code,text]);
        }
        if (localName === 'record') {
            readableStream.push({ record });
            record = [];
            recordNum++;

            if (recordNum % 1000 === 0) {
                logger.info(`record: ${recordNum}`);
            }
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