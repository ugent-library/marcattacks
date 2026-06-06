import { describe, test, expect } from "@jest/globals";
import { buildFix } from "../../dist/fix/index.js";

// Apply a fix the way Catmandu's unit tests do: build it from args, run on a
// (cloned) input record, compare to the expected output. Cases are ported
// verbatim from Catmandu's t/Catmandu-Fix-*.t (is_deeply assertions).
function fix(name: string, args: string[], data: any): any {
    return buildFix(name, args)(structuredClone(data));
}

describe("Fix conformance — ported from Catmandu t/", () => {
    test("copy_field", () => {
        expect(fix("copy_field", ["old", "new"], { old: "old" })).toEqual({ old: "old", new: "old" });
        expect(fix("copy_field", ["old", "deeply.nested.$append.new"], { old: "old" }))
            .toEqual({ old: "old", deeply: { nested: [{ new: "old" }] } });
        expect(fix("copy_field", ["old.*", "deeply.nested.$append.new"], { old: ["old", "older"] }))
            .toEqual({ old: ["old", "older"], deeply: { nested: [{ new: "old" }, { new: "older" }] } });
        expect(fix("copy_field", ["nested", "."], { nested: { bar: "baz" }, foo: "bar" })).toEqual({ bar: "baz" });
        expect(fix("copy_field", ["nested", "."], { nested: [1, 2, 3], foo: "bar" })).toEqual([1, 2, 3]);
        expect(fix("copy_field", ["''", "test"], { "": "foo" })).toEqual({ "": "foo", test: "foo" });
        expect(fix("copy_field", ["test", "''"], { test: "foo" })).toEqual({ test: "foo", "": "foo" });
        expect(fix("copy_field", ["test", "x.''"], { test: "foo" })).toEqual({ test: "foo", x: { "": "foo" } });
    });

    test("move_field", () => {
        expect(fix("move_field", ["old", "new"], { old: "old" })).toEqual({ new: "old" });
        expect(fix("move_field", ["old", "deeply.nested.$append.new"], { old: "old" }))
            .toEqual({ deeply: { nested: [{ new: "old" }] } });
        expect(fix("move_field", ["nested", "."], { nested: { bar: "baz" }, foo: "bar" })).toEqual({ bar: "baz" });
        expect(fix("move_field", ["nested", "."], { nested: [1, 2, 3], foo: "bar" })).toEqual([1, 2, 3]);
        expect(fix("move_field", ["''", "test"], { "": "foo" })).toEqual({ test: "foo" });
        expect(fix("move_field", ["test", "''"], { test: "foo" })).toEqual({ "": "foo" });
        expect(fix("move_field", ["test", "x.''"], { test: "foo" })).toEqual({ x: { "": "foo" } });
    });

    test("add_field (creates intermediate path)", () => {
        expect(fix("add_field", ["job", "fixer"], {})).toEqual({ job: "fixer" });
        expect(fix("add_field", ["deeply.nested.$append.job", "fixer"], {}))
            .toEqual({ deeply: { nested: [{ job: "fixer" }] } });
        expect(fix("add_field", ["deeply.nested.1.job", "fixer"], {}))
            .toEqual({ deeply: { nested: [undefined, { job: "fixer" }] } });
        expect(fix("add_field", ["deeply.nested.$append.job", "fixer"], { deeply: { nested: {} } }))
            .toEqual({ deeply: { nested: {} } });
        expect(fix("add_field", ["test", "0123"], {})).toEqual({ test: "0123" });
        expect(fix("add_field", ["test"], {})).toEqual({ test: null });
        expect(fix("add_field", ["''", "empty"], {})).toEqual({ "": "empty" });
        expect(fix("add_field", ["'a'", "test"], {})).toEqual({ a: "test" });
        expect(fix("add_field", ['"a"', "test"], {})).toEqual({ a: "test" });
    });

    test("set_field (only sets if intermediate exists)", () => {
        expect(fix("set_field", ["job", "fixer"], {})).toEqual({ job: "fixer" });
        expect(fix("set_field", ["deeply.nested.$append.job", "fixer"], {})).toEqual({});
        expect(fix("set_field", ["deeply.nested.*.job", "fixer"], { deeply: { nested: [undefined, {}] } }))
            .toEqual({ deeply: { nested: [undefined, { job: "fixer" }] } });
        expect(fix("set_field", ["test", "0123"], { test: "ok" })).toEqual({ test: "0123" });
        expect(fix("set_field", ['"a b c"', "test"], {})).toEqual({ "a b c": "test" });
    });

    test("remove_field", () => {
        expect(fix("remove_field", ["remove"], { remove: "me", keep: "me" })).toEqual({ keep: "me" });
        expect(fix("remove_field", ["''"], { a: "A", "": "Empty", c: "C" })).toEqual({ a: "A", c: "C" });
        expect(fix("remove_field", ['""'], { a: "A", "": "Empty", c: "C" })).toEqual({ a: "A", c: "C" });
        expect(fix("remove_field", ["x.''"], { x: { a: "A", "": "Empty", c: "C" } })).toEqual({ x: { a: "A", c: "C" } });
    });

    test("upcase / downcase / capitalize", () => {
        expect(fix("upcase", ["name"], { name: "joe" })).toEqual({ name: "JOE" });
        expect(fix("upcase", ["names.*.name"], { names: [{ name: "joe" }, { name: "rick" }] }))
            .toEqual({ names: [{ name: "JOE" }, { name: "RICK" }] });
        expect(fix("downcase", ["name"], { name: "JOE" })).toEqual({ name: "joe" });
        expect(fix("capitalize", ["name"], { name: "joe" })).toEqual({ name: "Joe" });
        expect(fix("capitalize", ["names.*"], { names: ["joe", "rick"] })).toEqual({ names: ["Joe", "Rick"] });
    });

    test("trim", () => {
        expect(fix("trim", ["name"], { name: "\tjoe  " })).toEqual({ name: "joe" });
        expect(fix("trim", ["name", "nonword"], { name: "/\tjoe  .  " })).toEqual({ name: "joe" });
        expect(fix("trim", ["id", "whitespace"], { id: " 0423985325   " })).toEqual({ id: "0423985325" });
        expect(fix("trim", ["name", "whitespace"], { name: " 宮川   " })).toEqual({ name: "宮川" });
    });

    test("replace_all", () => {
        expect(fix("replace_all", ["date", "\\d{2}", "01"], { date: "July 23" })).toEqual({ date: "July 01" });
        expect(fix("replace_all", ["date", "(\\d{2})", "${1}th"], { date: "July 23" })).toEqual({ date: "July 23th" });
        expect(fix("replace_all", ["words", "/b", ""], { words: "/bar" })).toEqual({ words: "ar" });
    });

    test("prepend / append", () => {
        expect(fix("prepend", ["name", "mr. "], { name: "smith" })).toEqual({ name: "mr. smith" });
        expect(fix("append", ["name", "y"], { name: "joe" })).toEqual({ name: "joey" });
        expect(fix("append", ["names.*.name"], { names: [{ name: "joe" }] })).toBeDefined();
    });

    test("join_field / split_field", () => {
        expect(fix("join_field", ["joinme", ","], { joinme: ["J", "O", "I", "N"] })).toEqual({ joinme: "J,O,I,N" });
        expect(fix("join_field", ["joinme", ","], { joinme: { skip: "me" } })).toEqual({ joinme: { skip: "me" } });
        expect(fix("join_field", ["joinme", ","], { joinme: ["J", { skip: "me" }, "I", "N"] })).toEqual({ joinme: "J,I,N" });
        expect(fix("split_field", ["splitme", ","], { splitme: "a,b,c" })).toEqual({ splitme: ["a", "b", "c"] });
        expect(fix("split_field", ["splitme", ","], { splitme: ["a", "b", "c"] })).toEqual({ splitme: ["a", "b", "c"] });
    });

    test("paste", () => {
        expect(fix("paste", ["my.string", "a", "b", "c", "d"], { a: "eeny", b: "meeny", c: "miny", d: "moe" }))
            .toMatchObject({ my: { string: "eeny meeny miny moe" } });
        expect(fix("paste", ["my.string", "a", "b", "join_char", ", "], { a: "eeny", b: "meeny" }))
            .toMatchObject({ my: { string: "eeny, meeny" } });
    });
});
