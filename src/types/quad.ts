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

export function isRecord(data: any) : data is Record {
    return (
        data !== null &&
        typeof data === 'object' &&
        Array.isArray(data.quads)
    );
}