import { describe, test, expect } from "@jest/globals";
import { marcForEachSub, marcind, marcmap, marcsubfields, marctag } from '../dist/marcmap.js';

const demoRecord = [
    [ '100', '0', '1', 'a', 'test123' ],
    [ '101', '0', '1', 'a', 'test', 'a', '123' ],
    [ '102', '0', '1', 'a', 'test' ],
    [ '102', '0', '1', 'a', '123' ],
    [ '103', '0', '1', 'a', 'test' , 'a', '123' ],
    [ '103', '0', '1', 'a', '456' ],
    [ '104', '0', '1', 'b', '123' , 'a', '456' ],
];

describe('marctag', () => {
    test('marctag finds a tag', () => {
        expect(marctag(demoRecord[0])).toBe('100');
    });
    test('marctag on an undefined row', () => {
        expect(marctag(undefined)).toBe("");
    });
    test('marctag on an empty row', () => {
        expect(marctag([])).toBe("");
    });
});

describe('marcind', () => {
    test('marcind finds indicators', () => {
        expect(marcind(demoRecord[0])).toStrictEqual(['0','1']);
    });
    test('marcind on an undefined row', () => {
        expect(marcind(undefined)).toStrictEqual([' ',' ']);
    });
    test('marcind on an empty row', () => {
        expect(marcind([])).toStrictEqual([' ',' ']);
    });
});

describe("marcmap", () => {
    test("marcmap reads 100a", () => {
        expect(marcmap(demoRecord,"100a")).toStrictEqual(["test123"]);
    });
    test("marcmap does not read 199a", () => {
        expect(marcmap(demoRecord,"199a")).toStrictEqual([]);
    });
    test("marcmap read 101a (repeated subfields)", () => {
        expect(marcmap(demoRecord,"101a")).toStrictEqual(["test 123"]);
    });
    test("marcmap read 101a with a join_char", () => {
        expect(marcmap(demoRecord,"101a",{join_char: "|"})).toStrictEqual(["test|123"]);
    });
    test("marcmap read 102a (repeated rows)", () => {
        expect(marcmap(demoRecord,"102a")).toStrictEqual(["test","123"]);
    });
    test("marcmap read 103a (repeated rows and subfields)", () => {
        expect(marcmap(demoRecord,"103a")).toStrictEqual(["test 123","456"]);
    });
    test("marcmap read 104ab keeping record order", () => {
        expect(marcmap(demoRecord,"104ab")).toStrictEqual(["123 456"]);
    });
    test("marcmap read 104 keeping record order", () => {
        expect(marcmap(demoRecord,"104")).toStrictEqual(["123 456"]);
    });
});

describe('marcsubfields', () => {
    test("marcsubfields .* keeping record order", () => {
        expect(marcsubfields(demoRecord[6],new RegExp(".*"))).toStrictEqual(["123","456"]);
    });
    test("marcsubfields ab keeping record order", () => {
        expect(marcsubfields(demoRecord[6],new RegExp("a|b"))).toStrictEqual(["123","456"]);
    });
});

describe('marcForEachSub', () => {
    test("marcForEachSub on multiple subfields", () => {
        const collect: string[] = [];
        const fn = (code:string, value:string ) => {
            collect.push(code);
            collect.push(value);
        };
        marcForEachSub(demoRecord[6],fn);
        expect(collect).toStrictEqual(["b","123","a","456"]);
    });
    test("marcForEachSub on empty record", () => {
        const collect: string[] = [];
        const fn = (code:string, value:string ) => {
            collect.push(code);
            collect.push(value);
        };
        marcForEachSub(undefined,fn);
        expect(collect).toStrictEqual([]);
    });
});

describe("marcForEachTag", () => {
    test("marcForEachTag record", () => {
        let i = 0;
        const fn = (tag:string, row: string[]) => {
            expect(tag).toBe(demoRecord[i][0]);
            expect(row).toStrictEqual(demoRecord[i]);
            i++;
        };
    });
});