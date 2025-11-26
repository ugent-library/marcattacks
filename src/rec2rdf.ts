import { EventEmitter } from 'node:events';
import { marcmap, marctag, marcind, marcsubfields , marcsubf} from './marcmap.js';
import N3, { Literal, NamedNode } from 'n3';
import { v4 as uuidv4 } from 'uuid';

const { DataFactory } = N3;
const { namedNode, literal, blankNode } = DataFactory;

type Rule = {
    predicate: string;
    type: "namedNode" | "literal";
    select: (rec: string[][], writer? : N3.Writer) => string | undefined;
};

type Lookup<T> = {
    [key: string]: T;
};

const prefixes : Lookup<string> = {
    this: 'https://lib.ugent.be/ns/',
    schema: 'https://schema.org/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    genid: 'https://lib.ugent.be/.well-known/genid/',
    viaf: 'http://viaf.org/viaf/'
}

const objectType : Lookup<string> = {
    article: 'schema:Article' ,
    book: 'schema:Book' ,
}

const RULES : Rule [] = [
    {
        predicate: `rdf:type`,
        type: "namedNode",
        select: (rec) => {
            let type = marcmap(rec,"920a",{})[0];
            if (type) {
                return objectType[type] ?? 'schema:CreativeWork';
            }
            else {
                return 'schema:CreativeWork';
            }
        }
    },
    {
        predicate: 'schema:author',
        type: 'namedNode',
        select: (rec,writer) => {
            let name = marcmap(rec,"100a",{})[0]?.replace(/,$/g,'');
            let viaf = marcmap(rec,"1000",{})[0];

            if (!name) {
                return undefined;
            }

            if (viaf && viaf.match(/\(viaf\)\d{3,}/)) {
                return undefined;
            }
            
            let bn = genid();

            writer?.addQuad(
                NS(bn) as NamedNode,
                NS('rdf:type') as NamedNode,
                NS('schema:Person') as NamedNode
            );

            writer?.addQuad(
                NS(bn) as NamedNode,
                NS('schema:name') as NamedNode,
                literal(name)
            );

            let dates = marcmap(rec,"100d",{})[0];

            if (dates && dates.match(/\d{4}-(\d{4})?/)) {
                let parts = dates.split("-",2);
                if (parts[0]) {
                    writer?.addQuad(
                        NS(bn) as NamedNode,
                        NS('schema:birthDate') as NamedNode,
                        literal(parts[0])
                    ); 
                }
                if (parts[1]) {
                    writer?.addQuad(
                        NS(bn) as NamedNode,
                        NS('schema:deathDate') as NamedNode,
                        literal(parts[1])
                    ); 
                }
            }

            return bn;
        }
    },
    {
        predicate: 'schema:author',
        type: 'namedNode',
        select: (rec,writer) => {
            let name = marcmap(rec,"100a",{})[0]?.replace(/,$/g,'');
            let viaf = marcmap(rec,"1000",{})[0];

            if (!name) {
                return undefined;
            }

            if (viaf && viaf.match(/\(viaf\)\d{3,}/)) {
                // we are ok
            }
            else {
                return undefined;
            }
            
            let bn = prefixes.viaf! + viaf.match(/\(viaf\)(\d+)/)?.[1];

            writer?.addQuad(
                NS(bn) as NamedNode,
                NS('rdf:type') as NamedNode,
                NS('schema:Person') as NamedNode
            );

            writer?.addQuad(
                NS(bn) as NamedNode,
                NS('schema:name') as NamedNode,
                literal(name)
            );

            let dates = marcmap(rec,"100d",{})[0];

            if (dates && dates.match(/\d{4}-(\d{4})?/)) {
                let parts = dates.split("-",2);
                if (parts[0]) {
                    writer?.addQuad(
                        NS(bn) as NamedNode,
                        NS('schema:birthDate') as NamedNode,
                        literal(parts[0])
                    ); 
                }
                if (parts[1]) {
                    writer?.addQuad(
                        NS(bn) as NamedNode,
                        NS('schema:deathDate') as NamedNode,
                        literal(parts[1])
                    ); 
                }
            }

            return bn;
        }
    },
    {
        predicate: 'schema:name',
        type: 'literal',
        select: (rec) => {
            let name = marcmap(rec,"245",{})[0];
            return name;
        }
    },
    {
        predicate: 'schema:datePublished',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"260c",{})[0]?.replaceAll(/\.$/g,'');
        }
    },
    {
        predicate: 'schema:publisher',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"260b",{})[0]?.replaceAll(/,$/g,'');
        }
    },  
    {
        predicate: 'schema:locationCreated',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"260a",{})[0]?.replaceAll(/ :$/g,'');
        }
    },
    {
        predicate: 'schema:description',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"500a",{})[0];
        }
    },
    {
        predicate: 'schema:alternativeHeadline',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"246a",{})[0];
        }
    },
    {
        predicate: 'schema:numberOfPages',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"300a",{})[0]?.replaceAll(/ :$/g,'');
        }
    },
    {
        predicate: 'schema:material',
        type: 'literal',
        select: (rec) => {
            return marcmap(rec,"340a",{})[0]?.replaceAll(/\.$/g,'');
        }
    },
    {
        predicate: 'schema:encoding',
        type: 'namedNode',
        select: (rec,writer) => {
            let url = marcmap(rec,"856u",{})[0];

            if (url) {
                let bn = genid();
                writer?.addQuad(
                    NS(bn) as NamedNode,
                    NS('rdf:type') as NamedNode,
                    NS('schema:MediaObject') as NamedNode
                );
                writer?.addQuad(
                    NS(bn) as NamedNode,
                    NS('schema:contentUrl')!,
                    NS(url) as NamedNode
                );
                return bn;
            }
            else {
                return undefined;
            }
        }
    }
];

export function rec2rdf(emitter: EventEmitter) : void {
    const writer = new N3.Writer(process.stdout, { 
        end: false, 
        prefixes
    });

    emitter.on("record", (rec: string[][]) => {
        let id = marcmap(rec,"001",{})[0];
        let idNode = namedNode(`${prefixes.this}${id}`);

        for (let i  = 0 ; i < RULES.length ; i++) {
            let select = RULES[i]?.select(rec,writer);
            let type  = RULES[i]?.type;
            let value;
           
            if (select) {
                if (type == "namedNode") {
                    value = NS(select);
                }
                else {
                    value = literal(select);
                }
            }

            let predicate = RULES[i]?.predicate;
            let prefix = NS(predicate);

            if (predicate && type && value && prefix) {
                if (type === 'namedNode') {
                    writer.addQuad(
                        idNode,
                        prefix,
                        value as NamedNode
                    );
                }
                else {
                    writer.addQuad(
                        idNode,
                        prefix,
                        value as Literal
                    ); 
                }
            }
        }
    });

    emitter.on("end", () => {
        writer.end();
    });
}

function NS(s: string | undefined ) : NamedNode | undefined {
    if (!s) {
        return undefined;
    }

    if (s.match(/^http.*/)) {
        return namedNode(s);
    }

    const pf = s.split(":"); 

    if (pf.length == 2) {
        return namedNode(`${prefixes[pf[0]!]}${pf[1]!}`);
    }
    else {
        return namedNode(s);
    }
}

function genid() : string {
    return `genid:${uuidv4()}`;
}