import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import {
    PipelineError,
    attack,
    createInputReadStream,
    createDecompressionStage,
    createUntarStage,
    createInputTransformStage,
    createCountSkipStage,
    createMapTransformStage,
    createOutputTransformStage,
    createOutputWriteStream,
    resolveWorkerCount,
    isAutoWorkers,
    shouldParallelize,
} from "../dist/attacker.js";
import { SlowWritable } from "../dist/stream/slow-writable.js";
import { Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-attacker-"));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

// A Writable that captures everything written to it as a string.
function sink(): { stream: Writable; text: () => string } {
    const chunks: string[] = [];
    const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
    });
    return { stream, text: () => chunks.join("") };
}

// Push one record through a map stage and return the single emitted record
// (closing the stage so any worker threads terminate).
function runOne(stage: any, rec: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const seen: any[] = [];
        stage.on("data", (r: any) => seen.push(r));
        stage.on("error", reject);
        stage.on("end", () => resolve(seen[0]));
        stage.write(rec);
        stage.end();
    });
}

describe("attacker — PipelineError", () => {
    test("carries a message and status code", () => {
        const err = new PipelineError("boom", 3);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(PipelineError);
        expect(err.message).toBe("boom");
        expect(err.statusCode).toBe(3);
    });
});

describe("attacker — stage builders", () => {
    test("createDecompressionStage triggers on .gz or opts.z, else null", async () => {
        expect(await createDecompressionStage(new URL("file:///x/a.json.gz"), {})).not.toBeNull();
        expect(await createDecompressionStage(new URL("file:///x/a.json"), { z: true })).not.toBeNull();
        expect(await createDecompressionStage(new URL("file:///x/a.json"), {})).toBeNull();
    });

    test("createUntarStage triggers on .tar/.tgz or opts.tar, else null", async () => {
        expect(await createUntarStage(new URL("file:///x/a.tar"), {})).not.toBeNull();
        expect(await createUntarStage(new URL("file:///x/a.tgz"), {})).not.toBeNull();
        expect(await createUntarStage(new URL("file:///x/a.json"), { tar: true })).not.toBeNull();
        expect(await createUntarStage(new URL("file:///x/a.json"), {})).toBeNull();
    });

    test("createInputTransformStage loads the named input plugin", async () => {
        const stage = await createInputTransformStage(new URL("file:///x/a.json"), { from: "json" });
        expect(typeof (stage as any).pipe).toBe("function");
    });

    test("createCountSkipStage triggers on count/skip, else null", async () => {
        expect(await createCountSkipStage({ count: 5 })).not.toBeNull();
        expect(await createCountSkipStage({ skip: 2 })).not.toBeNull();
        expect(await createCountSkipStage({})).toBeNull();
    });

    test("createMapTransformStage loads a map plugin, or null without --map", async () => {
        const stage = await createMapTransformStage({ map: "fix", param: { fix: 'add_field("a","b")' } });
        expect(typeof (stage as any).pipe).toBe("function");
        expect(await createMapTransformStage({})).toBeNull();
    });

    test("createOutputTransformStage loads the named output plugin, or null", async () => {
        const stage = await createOutputTransformStage({ to: "jsonl" });
        expect(typeof (stage as any).pipe).toBe("function");
        expect(await createOutputTransformStage({})).toBeNull();
    });

    test("createOutputWriteStream resolves the @slow / @errors / writable / file targets", async () => {
        expect(await createOutputWriteStream({ out: "@slow" })).toBeInstanceOf(SlowWritable);
        expect(await createOutputWriteStream({ out: "@errors" })).toBeInstanceOf(SlowWritable);

        const passthrough = sink().stream;
        expect(await createOutputWriteStream({ out: passthrough })).toBe(passthrough);

        const file = path.join(dir, "out.txt");
        const ws: any = await createOutputWriteStream({ out: file });
        expect(typeof ws.write).toBe("function");
        ws.end();

        const fileUrl = path.join(dir, "out2.txt");
        const ws2: any = await createOutputWriteStream({ out: `file://${fileUrl}` });
        expect(ws2.path).toBe(fileUrl);
        ws2.end();

        expect(await createOutputWriteStream({})).toBe(process.stdout);
    });

    test("createInputReadStream reads a local file and resolves the URL", async () => {
        const file = path.join(dir, "in.json");
        fs.writeFileSync(file, "[]");
        const { stream, resolvedUrl } = await createInputReadStream(new URL(`file://${file}`), {});
        expect(resolvedUrl.pathname).toBe(file);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c));
        expect(Buffer.concat(chunks).toString()).toBe("[]");
    });

    test("createInputReadStream maps stdin: to process.stdin", async () => {
        const { stream } = await createInputReadStream(new URL("stdin://"), {});
        expect(stream).toBe(process.stdin);
    });
});

describe("attacker — resolveWorkerCount (--workers default)", () => {
    test("isAutoWorkers: only undefined / 'auto' are auto", () => {
        expect(isAutoWorkers(undefined)).toBe(true);
        expect(isAutoWorkers("auto")).toBe(true);
        expect(isAutoWorkers("1")).toBe(false);
        expect(isAutoWorkers("8")).toBe(false);
        expect(isAutoWorkers(4)).toBe(false);
    });

    test("auto resolves to cores - 1 (leaving a core for the main thread)", () => {
        expect(resolveWorkerCount("auto", 8)).toBe(7);
        expect(resolveWorkerCount(undefined, 8)).toBe(7);
        expect(resolveWorkerCount("auto", 4)).toBe(3);
        expect(resolveWorkerCount("auto", 2)).toBe(1);
    });

    test("auto never drops below 1 (single-core hosts)", () => {
        expect(resolveWorkerCount("auto", 1)).toBe(1);
        expect(resolveWorkerCount("auto", 0)).toBe(1);
    });

    test("an explicit count is honored as-is, regardless of cores", () => {
        expect(resolveWorkerCount("1", 8)).toBe(1);
        expect(resolveWorkerCount("3", 8)).toBe(3);
        expect(resolveWorkerCount("16", 8)).toBe(16);   // clamping happens later, in the pool
        expect(resolveWorkerCount(4, 8)).toBe(4);
    });

    test("a non-numeric explicit value falls back to 1 (threading off)", () => {
        expect(resolveWorkerCount("nope", 8)).toBe(1);
        expect(resolveWorkerCount("", 8)).toBe(1);
    });

    test("shouldParallelize: auto only threads maps that opt in (autoParallel)", () => {
        const fix = { parallelizable: true, autoParallel: false };   // cheap, opts out
        const jsonata = { parallelizable: true, autoParallel: true }; // heavy, opts in
        const rdf = { parallelizable: false, autoParallel: false };   // no createMapper

        // auto (cores 8 -> 7 workers): only the opted-in map threads
        expect(shouldParallelize("auto", jsonata, 8)).toBe(true);
        expect(shouldParallelize("auto", fix, 8)).toBe(false);
        expect(shouldParallelize("auto", rdf, 8)).toBe(false);
    });

    test("shouldParallelize: an explicit --workers N threads any parallelizable map", () => {
        const fix = { parallelizable: true, autoParallel: false };
        const rdf = { parallelizable: false, autoParallel: false };

        expect(shouldParallelize("4", fix, 8)).toBe(true);   // explicit overrides the opt-out
        expect(shouldParallelize("4", rdf, 8)).toBe(false);  // ...but not a non-parallelizable map
        expect(shouldParallelize("1", fix, 8)).toBe(false);  // 1 disables threading
    });

    test("shouldParallelize: auto resolving to 1 worker never threads", () => {
        const jsonata = { parallelizable: true, autoParallel: true };
        expect(shouldParallelize("auto", jsonata, 1)).toBe(false);
    });

    test("auto + cheap map (fix) runs SERIAL, but maps correctly", async () => {
        // fix is parallelizable but does not opt into auto-threading, so the
        // auto default must NOT build a worker pool for it.
        const stage: any = await createMapTransformStage({
            map: "fix",
            param: { fix: 'add_field("w","1")' },
            // workers omitted -> auto
        });
        expect(stage.isWorkerPool).toBeFalsy();
        expect(await runOne(stage, { record: [["001", " ", " ", "_", "1"]] })).toMatchObject({ w: "1" });
    });

    test("explicit --workers on fix builds a worker-pool stage that still maps", async () => {
        const stage: any = await createMapTransformStage({
            map: "fix",
            param: { fix: 'add_field("w","1")' },
            workers: "2",
        });
        expect(stage.isWorkerPool).toBe(true);
        expect(await runOne(stage, { record: [["001", " ", " ", "_", "1"]] })).toMatchObject({ w: "1" });
    });
});

describe("attacker — attack() end to end", () => {
    test("runs a local json -> jsonl pipeline and returns the record count", async () => {
        const input = path.join(dir, "records.json");
        fs.writeFileSync(input, JSON.stringify([
            { record: [["001", " ", " ", "_", "111"]] },
            { record: [["001", " ", " ", "_", "222"]] },
        ]));

        const out = sink();
        const count = await attack(new URL(`file://${input}`), {
            from: "json",
            to: "jsonl",
            out: out.stream,
        });

        expect(count).toBe(2);
        const lines = out.text().trim().split("\n").filter(Boolean);
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).record[0][4]).toBe("111");
        expect(JSON.parse(lines[1]).record[0][4]).toBe("222");
    });

    test("attack() applies a --map fix stage in the pipeline", async () => {
        const input = path.join(dir, "records2.json");
        fs.writeFileSync(input, JSON.stringify([{ record: [["001", " ", " ", "_", "111"]] }]));

        const out = sink();
        const count = await attack(new URL(`file://${input}`), {
            from: "json",
            to: "jsonl",
            map: "fix",
            param: { fix: 'add_field("flagged","yes")' },
            out: out.stream,
        });

        expect(count).toBe(1);
        expect(JSON.parse(out.text().trim()).flagged).toBe("yes");
    });

    // When the downstream reader closes the pipe (e.g. `| less` then `q`, or
    // `| head`), the sink write fails with EPIPE. attack() must surface this as
    // a *quiet* PipelineError (readerDisconnected=true, statusCode 0) so the CLI
    // exits silently — never dumping a colorized stack to the tty that would
    // race a pager's terminal-restore sequence and wedge the terminal.
    test("attack() flags an EPIPE from the reader as a quiet PipelineError", async () => {
        const input = path.join(dir, "records3.json");
        fs.writeFileSync(input, JSON.stringify([{ record: [["001", " ", " ", "_", "111"]] }]));

        // A sink that behaves like a closed pipe: every write fails with EPIPE.
        const brokenPipe = new Writable({
            write(_chunk, _enc, cb) {
                const err: any = new Error("write EPIPE");
                err.code = "EPIPE";
                cb(err);
            },
        });

        await expect(attack(new URL(`file://${input}`), {
            from: "json",
            to: "jsonl",
            out: brokenPipe,
        })).rejects.toMatchObject({
            readerDisconnected: true,
            statusCode: 0,
        });
    });
});
