import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { fileReadStream, fileGlobFiles, fileLatestFile } from "../../dist/stream/filestream.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-fs-"));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

// Read a Readable fully into a string.
async function readAll(stream: any): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString("utf-8");
}

describe("stream/filestream", () => {
    test("fileReadStream reads a file's contents", async () => {
        const file = path.join(dir, "hello.txt");
        fs.writeFileSync(file, "hello world");

        const stream = await fileReadStream(new URL(`file://${file}`));
        expect(await readAll(stream)).toBe("hello world");
    });

    test("fileGlobFiles returns the URL unchanged when there is no @glob: pattern", async () => {
        const url = new URL(`file://${dir}/plain.txt`);
        const result = await fileGlobFiles(url);
        expect(result).toEqual([url]);
    });

    test("fileGlobFiles matches files by extension", async () => {
        const gdir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-glob-"));
        fs.writeFileSync(path.join(gdir, "a.txt"), "a");
        fs.writeFileSync(path.join(gdir, "b.txt"), "b");
        fs.writeFileSync(path.join(gdir, "c.log"), "c");

        const result = await fileGlobFiles(new URL(`file://${gdir}/@glob:txt`));
        const names = result.map((u) => path.basename(u.pathname)).sort();

        expect(names).toEqual(["a.txt", "b.txt"]);
        fs.rmSync(gdir, { recursive: true, force: true });
    });

    test("fileGlobFiles matches every file with @glob:*", async () => {
        const gdir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-glob-"));
        fs.writeFileSync(path.join(gdir, "a.txt"), "a");
        fs.writeFileSync(path.join(gdir, "c.log"), "c");

        const result = await fileGlobFiles(new URL(`file://${gdir}/@glob:*`));
        expect(result).toHaveLength(2);
        fs.rmSync(gdir, { recursive: true, force: true });
    });

    test("fileGlobFiles rejects when the directory cannot be read", async () => {
        await expect(
            fileGlobFiles(new URL(`file://${dir}/does-not-exist/@glob:txt`))
        ).rejects.toThrow(/Error reading directory for glob/);
    });

    test("fileLatestFile returns the URL unchanged when there is no @latest: pattern", async () => {
        const url = new URL(`file://${dir}/plain.txt`);
        expect(await fileLatestFile(url)).toEqual(url);
    });

    test("fileLatestFile resolves to the most recently modified matching file", async () => {
        const ldir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-latest-"));
        const older = path.join(ldir, "older.txt");
        const newer = path.join(ldir, "newer.txt");
        fs.writeFileSync(older, "old");
        fs.writeFileSync(newer, "new");
        // Force a clear mtime ordering regardless of write timing.
        fs.utimesSync(older, new Date(2000, 0, 1), new Date(2000, 0, 1));
        fs.utimesSync(newer, new Date(2020, 0, 1), new Date(2020, 0, 1));

        const result = await fileLatestFile(new URL(`file://${ldir}/@latest:txt`));
        expect(path.basename(result.pathname)).toBe("newer.txt");
        fs.rmSync(ldir, { recursive: true, force: true });
    });
});
