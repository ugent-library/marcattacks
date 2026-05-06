import { Transform } from "stream";
import { marcmap , marcForEachTag, marcsubfields } from '../marcmap.js';
import { v4 as uuidv4 } from 'uuid';

const prefixes = {
    this: 'https://lib.ugent.be/record',
    schema: 'https://schema.org/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    genid: 'https://lib.ugent.be/.well-known/genid/',
    owl: 'http://www.w3.org/2002/07/owl#',
    bibo: 'http://purl.org/ontology/bibo/',
    xmlschema: 'https://www.w3.org/2001/XMLSchema#',
};

export async function transform(_opts: any) : Promise<Transform> {
    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            let rec : string[][] = data['record'];

            if (!rec) {
                callback(null);
                return;
            }

            data['prefixes'] = prefixes;
            data['quads'] = rec2quads(rec);
            callback(null,data);
        }
    });
}

function rec2quads(rec: string[][]) {
    let quads : any[] = [];

    let id = marcmap(rec,"001",{});

    if (!id) return;

    marcForEachTag(rec, (tag,row) => {
        if (false) {}
        else if (tag === '035') {
            let value = marcsubfields(row,/a/)[0];
        
            if (value?.match(/^\(RUG01\)\d+/)) {
                value = 'https://lib.ugent.be/catalog/rug01:' + value.replace(/\(RUG01\)(.*)/,"$1");
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}replaces` },
                    object: { value: value },
                });
            }
            else if (value?.match(/^\(BIBLIO\)\d+/)) {
                value = 'https://biblio.ugent.be/record/' + value.replace(/\(BIBLIO\)(.*)/,"$1");
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}workExample` },
                    object: { value: value },
                });
            }
        }
        else if (tag === '100') {
            let name = marcsubfields(row,/a/);

            if (!name) {
                return undefined;
            }

            let bn = genid();

            let authorId = marcsubfields(row,/0/)[0];

            if (authorId?.match(/\(viaf\)\d{2,}/)) {
                bn = "https://viaf.org/viaf/" + authorId.replaceAll(/\(viaf\)/g,'');
            }

            quads.push({
                subject: { value: `${prefixes.this}${id}` },
                predicate: { value: `${prefixes.schema}author` },
                object: { value: bn },
            });

            quads.push({
                subject: { value: bn },
                predicate: { value: `${prefixes.rdf}type` },
                object: { value: `${prefixes.schema}Person` },
            }); 

            name.forEach( n => {
                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.schema}name` },
                    object: { value: strip(n) , type: 'Literal' },
                }); 
            });

            let dates = marcsubfields(row,/d/)[0];

            if (dates && dates.match(/\d{4}-(\d{4})?/)) {
                let parts = dates.split("-",2);
                if (parts[0]) {
                    quads.push({
                        subject: { value: bn },
                        predicate: { value: `${prefixes.schema}birthDate` },
                        object: { value: parts[0], type: 'Literal', as: `${prefixes.xmlschema}gYear` },
                    }); 
                }
                if (parts[1]) {
                    quads.push({
                        subject: { value: bn },
                        predicate: { value: `${prefixes.schema}deathDate` },
                        object: { value: parts[1], type: 'Literal', as: `${prefixes.xmlschema}gYear` },
                    }); 
                }
            }
        }
        else if (tag === '245') {
            let value = strip( marcsubfields(row,/[ab]/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}name` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '246') {
            let value = strip( marcsubfields(row,/a/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}alternativeHeadline` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '260') {
            let location  = strip( marcsubfields(row,/a/).join(" ") );
            let publisher = strip( marcsubfields(row,/b/).join(" ") );
            let date      = strip( marcsubfields(row,/c/).join(" ") );

            if (location) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}locationCreated` },
                    object: { value: location , type: 'Literal'}
                });
            }

            if (publisher) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}publisher` },
                    object: { value: publisher , type: 'Literal'}
                });
            }

            if (date) {
                if (date.match(/^\d{4}$/)) {
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.schema}datePublished` },
                        object: { value: date , type: 'Literal', as: `${prefixes.xmlschema}gYear` }
                    });
                }
                else {
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.schema}datePublished` },
                        object: { value: date , type: 'Literal'}
                    });
                }
            }
        }
        else if (tag === '300') {
            let value = strip( marcsubfields(row,/a/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}numberOfPages` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '340') {
            let value = strip( marcsubfields(row,/a/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}material` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '500') {
            let value = strip( marcsubfields(row,/a/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}description` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '520') {
            let value = strip( marcsubfields(row,/a/).join(" ") );
            if (value) {
                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}abstract` },
                    object: { value , type: 'Literal'}
                });
            }
        }
        else if (tag === '650') {
            let bn = genid();

            quads.push({
                subject: { value: `${prefixes.this}${id}` },
                predicate: { value: `${prefixes.schema}about` },
                object: { value: bn }
            });

            quads.push({
                subject: { value: bn },
                predicate: { value: `${prefixes.rdf}type` },
                object: { value: `${prefixes.schema}Thing`}
            });

            marcsubfields(row,/a|x/).forEach(v =>  {
                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.schema}name` },
                    object: { value: strip(v) , type: 'Literal'}
                });
            });
            marcsubfields(row,/v/).forEach(v =>  {
                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.schema}genre` },
                    object: { value: strip(v) , type: 'Literal'}
                });
            });
            marcsubfields(row,/y/).forEach(v =>  {
                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.schema}temporalCoverage` },
                    object: { value: strip(v) , type: 'Literal'}
                });
            });
            marcsubfields(row,/z/).forEach(v =>  {
                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.schema}spatialCoverage` },
                    object: { value: strip(v) , type: 'Literal'}
                });
            });
        }
        else if (tag === '856') {
            let value = strip( marcsubfields(row,/u/).join(" ") );
            if (value) {
                let bn = genid();

                quads.push({
                    subject: { value: `${prefixes.this}${id}` },
                    predicate: { value: `${prefixes.schema}encoding` },
                    object: { value: bn }
                });

                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.rdf}type` },
                    object: { value: `${prefixes.schema}MediaObject`}
                });

                quads.push({
                    subject: { value: bn },
                    predicate: { value: `${prefixes.rdf}contentUrl` },
                    object: { value }
                });
            }
        }
        else if (tag === '920') {
            let value = strip( marcsubfields(row,/a/).join(" ") );

            if (!value) return;
            
            switch (value) {
                case 'catalog':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Book`}
                    });
                    break;
                case 'correspondence':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}CreativeWork`}
                    });
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.bibo}Letter`}
                    });
                    break;
                case 'book':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Book`}
                    });
                    break;
                case 'dissertation':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Thesis`}
                    });
                    break;
                case 'ephemera':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}CreativeWork`}
                    });
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.bibo}Document  `}
                    });
                    break;
                case 'image':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}VisualArtwork`}
                    });
                    break;
                case 'manuscript':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Book`}
                    });
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.bibo}Manuscript`}
                    });
                    break;
                case 'map':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Map`}
                    });
                    break;
                case 'master':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Thesis`}
                    });
                    break;
                case 'periodical':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Periodical`}
                    });
                    break;
                case 'phd':
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}Thesis`}
                    });
                    break;
                default:
                    quads.push({
                        subject: { value: `${prefixes.this}${id}` },
                        predicate: { value: `${prefixes.rdf}type` },
                        object: { value: `${prefixes.schema}CreativeWork`}
                    });
                    break;
            }
        }
    });

    return quads;
}   

function strip(s: string) : string {
    return s.replaceAll(/\s*[\,.:\/]$/g,'');
}

function genid() : string {
    return `genid:${uuidv4()}`;
}