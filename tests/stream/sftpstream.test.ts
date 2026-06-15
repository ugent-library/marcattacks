import { describe, test, expect, jest } from "@jest/globals";
import log4js from "log4js";
import { sftpLatestFile, sftpGlobFiles } from "../../dist/stream/sftpstream.js";

// Capture everything logged at info level. The module holds its own logger
// instance, but every instance shares the prototype's info(), so spying on the
// prototype intercepts the calls regardless of the configured level.
function captureInfo(): { calls: () => string; restore: () => void } {
    const proto = Object.getPrototypeOf(log4js.getLogger());
    const spy = jest.spyOn(proto, "info").mockImplementation(() => {});
    return {
        calls: () => spy.mock.calls.map((c: any[]) => c.map(String).join(" ")).join("\n"),
        restore: () => spy.mockRestore(),
    };
}

describe("stream/sftpstream credential redaction", () => {
    // Both functions return early (no SSH connection) when the path carries no
    // @latest:/@glob: marker, which exercises the two url.href log sites without
    // needing a live server.
    test("sftpLatestFile never logs the SFTP password", async () => {
        const log = captureInfo();
        try {
            const url = new URL("sftp://alice:hunter2@example.org:22/data/file.xml");
            const resolved = await sftpLatestFile(url, {});
            expect(resolved.href).toBe(url.href); // resolves to the original input

            const logged = log.calls();
            expect(logged).not.toContain("hunter2"); // password must not appear
            expect(logged).toContain("***");         // redacted form is logged
        } finally {
            log.restore();
        }
    });

    test("sftpGlobFiles neither logs nor returns the SFTP credentials", async () => {
        const log = captureInfo();
        try {
            const url = new URL("sftp://bob:s3cr3t@example.org:22/data/file.xml");
            const files = await sftpGlobFiles(url, {});

            // #8: the returned URLs are printed to stdout by globtrotr, so they
            // must be credential-free (username + password stripped).
            expect(files).toHaveLength(1);
            expect(files[0]?.href).toBe("sftp://example.org:22/data/file.xml");
            expect(files[0]?.href).not.toContain("s3cr3t");
            expect(files[0]?.href).not.toContain("bob");

            // #3: the log line is also redacted.
            const logged = log.calls();
            expect(logged).not.toContain("s3cr3t");
            expect(logged).toContain("***");
        } finally {
            log.restore();
        }
    });
});
