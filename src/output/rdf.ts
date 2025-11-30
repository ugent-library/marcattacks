import { Readable, Writable } from 'stream';
import N3 from 'n3';

import log4js from 'log4js';

const logger = log4js.getLogger();

const { DataFactory } = N3;
const { namedNode, literal, blankNode } = DataFactory;

export function readable2writable(readable: Readable, writable: Writable) : void {
    let writer : N3.Writer;

    readable.on('data', (data: any)  => {   
        let prefixes = data['prefixes'];

        if (!writer) {
            writer = new N3.Writer(writable, { end: false, prefixes });
        }

        let quads : any[] = data['quads'];

        if (!quads) return;

        for (let i = 0 ; i < quads.length ; i++) {
            if (quads[i].subject && quads[i].predicate && quads[i].object) {
                // ok
            }
            else return;
            
            let subject   = { type: 'NamedNode', value: '', ...quads[i].subject};
            let predicate = { type: 'NamedNode', value: '', ...quads[i].predicate};
            let object    = { type: 'NamedNode', value: '', ...quads[i].object};

            let subjectValue = 
                subject.type === 'NamedNode' ? namedNode(subject.value) 
                : subject.type === 'BlankNode' ? blankNode(subject.value)
                : namedNode(subject.value);
            
            let predicateValue = 
                predicate.type === 'NamedNode' ? namedNode(predicate.value) 
                : namedNode(predicate.value);
            
            let objectValue = 
                object.type === 'NamedNode' ? namedNode(object.value) 
                : object.type === 'BlankNode' ? blankNode(object.value)
                : object.type === 'Literal' && object.as ? literal(object.value, namedNode(object.as))
                : object.type === 'Literal' ? literal(object.value)
                : namedNode(object.value);

            writer.addQuad(
                subjectValue,
                predicateValue,
                objectValue
            );
        }
    });

    readable.on('end', () => {
        writer.end();
    });
}