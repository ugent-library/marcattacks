import { Readable } from 'stream';
import N3, { Literal, NamedNode } from 'n3';

const { DataFactory } = N3;
const { namedNode, literal, blankNode } = DataFactory;

export function rec2rdf(stream: Readable) : void {
    let writer : N3.Writer;

    stream.on('data', (data: any)  => {   
        if (!writer) {
            writer = new N3.Writer(process.stdout, { end: false });
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
                : object.type === 'Literal' ? literal(object.value)
                : namedNode(object.value);

            writer.addQuad(
                subjectValue,
                predicateValue,
                objectValue
            );
        }
    });

    stream.on('end', () => {
        writer.end();
    });
}