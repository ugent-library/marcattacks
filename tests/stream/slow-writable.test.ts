import { describe, test, expect } from "@jest/globals";
import { SlowWritable } from "../../dist/stream/slow-writable.js";

// Write every chunk, end the stream, and resolve once it has finished.
async function writeAll(w: any, chunks: any[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        w.on("finish", resolve);
        w.on("error", reject);
        for (const c of chunks) w.write(c);
        w.end();
    });
}

describe("stream/slow-writable", () => {
    test("processes all chunks and finishes", async () => {
        const w = new SlowWritable({ delayMs: 1 });
        await writeAll(w, ["a", "b", "c"]);
        expect(w.writableFinished).toBe(true);
    });

    test("honours maxConcurrency > 1", async () => {
        const w = new SlowWritable({ delayMs: 1, maxConcurrency: 3 });
        await writeAll(w, ["a", "b", "c", "d", "e"]);
        expect(w.writableFinished).toBe(true);
    });

    test("clamps a non-positive maxConcurrency to at least 1", async () => {
        // maxConcurrency 0 would deadlock the processing loop if not clamped.
        const w = new SlowWritable({ delayMs: 1, maxConcurrency: 0 });
        await writeAll(w, ["a", "b"]);
        expect(w.writableFinished).toBe(true);
    });

    test("simulateErrorEveryN surfaces an error on the failing chunk", async () => {
        const w = new SlowWritable({ delayMs: 1, simulateErrorEveryN: 1 });
        // The first chunk's write callback receives the simulated error, which
        // the stream re-emits as an 'error' event.
        const err = await new Promise<Error>((resolve) => {
            w.on("error", resolve);
            w.write("a");
        });
        expect(err.message).toMatch(/Simulated error/);
        w.destroy();
    });
});
