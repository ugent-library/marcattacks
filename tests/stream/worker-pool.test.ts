import { describe, test, expect } from "@jest/globals";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
// Import from the built dist (like worker.test.ts): the pool resolves its
// worker thread relative to its own module URL, which only points at a real
// `worker.js` when running the compiled build, not the ts-jest source.
// @ts-expect-error - no type declarations emitted for dist
import { createWorkerPool } from "../../dist/stream/worker-pool.js";

// A consumer that is slower than the producer: highWaterMark 1 and a deferred
// callback, so its buffer fills and push() into it returns false. This is the
// condition that exposed the pump() bug — when push() returned false the head
// record was re-pushed instead of shifted, looping the same record forever (so
// only the never-backed-up `null` sink completed). The pool must still emit
// each record exactly once, in order, and terminate.
class BackpressuringCollector extends Writable {
    public received: any[] = [];
    constructor() {
        super({ objectMode: true, highWaterMark: 1 });
    }
    _write(chunk: any, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
        this.received.push(chunk);
        setImmediate(cb); // slower than the producer -> real backpressure
    }
}

describe("worker pool", () => {
    test(
        "emits every record exactly once, in order, against a back-pressuring sink",
        async () => {
            const N = 500;
            const input = Array.from({ length: N }, (_, i) => ({ i }));
            const pool = createWorkerPool({
                map: "fix",
                param: { fix: 'add_field("seen","1")' },
                workers: 4,
            });
            const sink = new BackpressuringCollector();

            await pipeline(Readable.from(input), pool, sink);

            // exactly N records, no duplicates, original order preserved
            expect(sink.received).toHaveLength(N);
            expect(sink.received.map((r) => r.i)).toEqual(input.map((r) => r.i));
            expect(sink.received.every((r) => r.seen === "1")).toBe(true);
        },
        30_000,
    );

    test(
        "fan-out map (explode): explodes each record into one row per field, in order",
        async () => {
            // Two MARC records: 2 fields and 3 fields -> 5 rows total.
            const input = [
                { record: [["001", " ", " ", "_", "rec1"], ["245", "1", "0", "a", "A"]] },
                { record: [["001", " ", " ", "_", "rec2"], ["100", "1", " ", "a", "X"], ["650", " ", "0", "a", "Y"]] },
            ];
            const pool = createWorkerPool({
                map: "./plugin/explode.js",   // resolved via path.resolve from cwd (repo root)
                param: {},
                workers: 2,
                fanOut: true,
            });
            const sink = new BackpressuringCollector();

            await pipeline(Readable.from(input), pool, sink);

            // One row per field across both records, original order preserved.
            expect(sink.received).toHaveLength(5);
            expect(sink.received.map((r) => [r.record_id, r.field_seq, r.tag])).toEqual([
                ["rec1", 0, "001"],
                ["rec1", 1, "245"],
                ["rec2", 0, "001"],
                ["rec2", 1, "100"],
                ["rec2", 2, "650"],
            ]);
        },
        30_000,
    );
});
