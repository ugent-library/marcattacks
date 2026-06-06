import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "../dist/worker.js");

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "marcattacks-worker-"));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

// Start a worker, wait for its {ready:true}, send one batch, resolve with the
// worker's response message, then terminate it.
function runBatch(workerData: any, batch: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const w = new Worker(workerPath, { workerData });
        w.on("error", reject);
        w.on("message", (msg: any) => {
            if (msg.ready) {
                w.postMessage({ seq: 1, batch });
                return;
            }
            resolve(msg);
            w.terminate();
        });
    });
}

describe("worker (thread entry)", () => {
    test("maps each record in a batch with the requested map", async () => {
        const msg = await runBatch({ map: "fix", param: { fix: 'add_field("a","b")' } }, [{ x: 1 }, { y: 2 }]);
        expect(msg).toEqual({ seq: 1, mapped: [{ x: 1, a: "b" }, { y: 2, a: "b" }] });
    });

    test("a rejected record comes back as null", async () => {
        const msg = await runBatch({ map: "fix", param: { fix: "reject()" } }, [{ x: 1 }]);
        expect(msg).toEqual({ seq: 1, mapped: [null] });
    });

    test("a mapper error is reported as { seq, error }", async () => {
        const file = path.join(dir, "throws.jsonata");
        fs.writeFileSync(file, "$notafunction()");

        const msg = await runBatch({ map: "jsonata", param: { fix: file } }, [{ x: 1 }]);
        expect(msg.seq).toBe(1);
        expect(typeof msg.error).toBe("string");
        expect(msg.error.length).toBeGreaterThan(0);
    });

    test("a non-parallelizable map (no createMapper) fails the worker on startup", async () => {
        await expect(new Promise((resolve, reject) => {
            const w = new Worker(workerPath, { workerData: { map: "avram", param: {} } });
            w.on("error", reject);
            w.on("message", resolve);
        })).rejects.toThrow(/not parallelizable/);
    });
});
