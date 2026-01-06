export interface QVal {
    value: string;
    type: string;
    as?: string;
    language?: string;
}

export interface Quad {
    subject: QVal;
    predicate: QVal;
    object: QVal;
}

export interface Record {
    prefixes: {
        [prefix: string]: string;
    };
    quads: Quad[]
}