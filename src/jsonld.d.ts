declare module 'jsonld' {
    import type * as RDF from '@rdfjs/types';

    const jsonld: {
        toRDF: (input: any, options?: any) => Promise<RDF.Quad[] | string>;
        expand: (input: any, options?: any) => Promise<any[]>;
        [key: string]: any;
    };

    export default jsonld;
}
