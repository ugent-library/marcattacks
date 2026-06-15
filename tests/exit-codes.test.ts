import { describe, test, expect } from "@jest/globals";
import { ExitCode, classifyError } from "../dist/exit-codes.js";

function withCode(code: string, message = "boom"): Error {
    const e: any = new Error(message);
    e.code = code;
    return e;
}

describe("exit-codes/classifyError", () => {
    test("an explicit exitCode tag wins over everything", () => {
        const e: any = withCode("ENOENT");
        e.exitCode = ExitCode.PROTOCOL;
        expect(classifyError(e)).toBe(ExitCode.PROTOCOL);
    });

    test("an exitCode tagged on a cause is honored", () => {
        const inner: any = new Error("inner");
        inner.exitCode = ExitCode.SOFTWARE;
        const outer = new Error("outer", { cause: inner });
        expect(classifyError(outer)).toBe(ExitCode.SOFTWARE);
    });

    test("maps Node error codes to sysexits categories", () => {
        expect(classifyError(withCode("ENOENT"))).toBe(ExitCode.NOINPUT);
        expect(classifyError(withCode("EACCES"))).toBe(ExitCode.NOPERM);
        expect(classifyError(withCode("EPERM"))).toBe(ExitCode.NOPERM);
        expect(classifyError(withCode("ECONNRESET"))).toBe(ExitCode.IOERR);
        expect(classifyError(withCode("ETIMEDOUT"))).toBe(ExitCode.IOERR);
        expect(classifyError(withCode("ERR_STREAM_PREMATURE_CLOSE"))).toBe(ExitCode.IOERR);
    });

    test("HTTP status and redirect messages map to EX_PROTOCOL", () => {
        expect(classifyError(new Error("HTTP 404"))).toBe(ExitCode.PROTOCOL);
        expect(classifyError(new Error("too many redirects (> 10)"))).toBe(ExitCode.PROTOCOL);
    });

    test("a SyntaxError (data parse) maps to EX_DATAERR", () => {
        let parseErr: unknown;
        try { JSON.parse("{not json"); } catch (e) { parseErr = e; }
        expect(classifyError(parseErr)).toBe(ExitCode.DATAERR);
    });

    test("an unrecognized error is an internal/software error", () => {
        expect(classifyError(new Error("???"))).toBe(ExitCode.SOFTWARE);
    });

    test("finds a recognizable code deeper in the cause chain", () => {
        const root = withCode("ECONNRESET", "aborted");
        const mid = new Error("read failed", { cause: root });
        const top = new Error("pipeline closed prematurely", { cause: mid });
        expect(classifyError(top)).toBe(ExitCode.IOERR);
    });
});
