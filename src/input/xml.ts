import { pipeline, Readable } from 'stream';
import sax from 'sax';
import log4js from 'log4js';

type FieldAttribute = { [key: string]: string; } | { [key: string]: sax.QualifiedAttribute; };
type SubfieldAttribute = { [key: string]: string; };
type MARCType = 'leader' | 'control' | 'field' | 'subfield' | undefined;

const logger = log4js.getLogger();

export async function stream2readable(stream: Readable) : Promise<Readable> {
    let recordNum = 0;

    let sourcePaused = false;

    const readableStream = new Readable({
        read() {
            if (sourcePaused) {
                logger.debug("backpressure off");
                stream.resume(); 
                sourcePaused = false;
            }
        } ,
        objectMode: true 
    });

    const parser = sax.createStream(true);

    let record : string[][] = [];
    let subfield : string[] = [];
    let attrib : FieldAttribute = {};
    let sattrib : SubfieldAttribute = {};
    let type : MARCType;
    let text : string = '';
    let hasError = false;
        
    parser.on('opentag', (node: sax.Tag) => {
        if (hasError) return; 

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
        if (hasError) return; 

        text += t;
    });

    parser.on('closetag', (tag: string) => {
        if (hasError) return; 

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
            const ok = readableStream.push({ record });
            
            if (!ok) {
                logger.debug("backpressure on");
                stream.pause();
                sourcePaused = true;
            }

            record = [];
            recordNum++;

            if (recordNum % 1000 === 0) {
                logger.info(`record: ${recordNum}`);
            }
        }
    }); 

    parser.on("error", (err) => {
        if (hasError) return; 
        hasError = true;

        logger.error ("Parser error:", err.message);
        stream.destroy();
        parser.end();
        readableStream.destroy(err instanceof Error ? err : new Error(String(err)));
    });

    parser.on('end', () => {
        if (hasError) return;

        logger.info(`processed ${recordNum} records`);
        readableStream.push(null);
    });

    stream.on('data', (chunk) => {
        if (hasError) return; 
        parser.write(chunk);
    });

    stream.on('end', () => {
        if (hasError) return; 
        parser.end();
    });

    stream.on('error', (err) => {
        if (hasError) return; 
        hasError = true;
    
        logger.error("Source stream error:", err);
        stream.destroy();
        parser.end();
        readableStream.destroy(err);
    });

    return readableStream;
}   