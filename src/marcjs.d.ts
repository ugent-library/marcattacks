declare module 'marcjs' {
    import { Duplex } from "stream";

    export const Marc: {
        createStream: (type: string, string: "Parser" | "formater") => Duplex;
        parse: (raw: string, type: string) => any;
        format: (record: any, type: string) => string;
    };

    export class Record {
        as(type: string): string;
    }
}