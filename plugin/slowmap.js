import { Transform } from 'stream';

// slowmap.js — a DELIBERATELY SLOW demo map, built to show off `--workers`.
//
// It does NO useful MARC mapping. For every record it burns a fixed amount of
// CPU (a real busy-wait, so it actually pins a core — not a sleep) and stamps
// the result onto the record. Because the work is CPU-bound and synchronous,
// this is exactly the kind of map worker threads parallelize: the main thread
// can only chew one record at a time, but N workers chew N at once.
//
// Run it serial vs threaded and watch the wall-clock:
//
//   # ~10ms of pure CPU per record, single-threaded
//   marcattacks --map ./plugin/slowmap.js --param spin_ms=10 --workers 1 \
//               --to jsonl ./data/sample.xml
//
//   # same work, spread across CPU-cores-1 worker threads
//   marcattacks --map ./plugin/slowmap.js --param spin_ms=10 --workers auto \
//               --to jsonl ./data/sample.xml
//
// With enough records the threaded run finishes roughly N× faster (N = workers),
// minus the main-thread coordination overhead.
//
// --- How a plugin opts into the worker pool ----------------------------------
//
//   export const autoParallel = true   -> `--workers auto` threads this map.
//                                          (Without it, only an explicit
//                                          `--workers N` would thread it.)
//
//   export function createMapper(opts, ctx) -> a PURE record -> record mapper.
//                                          The pool calls this on each worker
//                                          thread; the serial transform() below
//                                          calls it too. Same function, same
//                                          ctx.utils, run in both places — so
//                                          there is exactly one copy of the
//                                          logic and the two paths can't drift.
//
// This map is 1 record -> 1 record, so it does NOT set `fanOut`. (z00r.js is
// the 1-to-many / fan-out example.)

// Thread under the default `--workers auto`, not just an explicit `--workers N`.
export const autoParallel = true;

// Pure record -> record mapper. All the work lives here so it is identical
// whether it runs in-process (transform, below) or on a worker thread.
// ctx.utils is the same context passed to transform(), so marcmap & friends
// are available on worker threads too.
export function createMapper(opts, ctx) {
    const { marcmap } = ctx.utils;
    const spinMs = Number(opts?.spin_ms ?? 10);   // CPU ms to burn per record

    return (data) => {
        const record = data['record'];
        const id = marcmap(record, "001")[0] ?? "UNKNOWN";

        // Busy-wait: a real loop the JIT can't elide (it feeds a checksum we
        // keep), so it genuinely occupies a core for ~spinMs milliseconds.
        const checksum = burnCpu(spinMs);

        return {
            "record_id": id,
            "spin_ms": spinMs,
            "checksum": checksum,
            // a fake "result" so the row isn't empty — NOT a real mapping
            "fields": record.length
        };
    };
}

// Spin for ~ms milliseconds doing pointless-but-unelidable arithmetic.
function burnCpu(ms) {
    const deadline = Date.now() + ms;
    let acc = 0;
    // Inner loop keeps the JIT honest; outer loop re-checks the clock cheaply.
    while (Date.now() < deadline) {
        for (let i = 0; i < 100000; i++) {
            acc = (acc + Math.sqrt(i + acc)) % 1e9;
        }
    }
    return Math.round(acc);
}

// Serial path (used for `--workers 1`, or when the pool isn't active): wrap the
// same mapper into a Transform, mirroring what the worker pool does on its side.
export function transform(opts, ctx) {
    const mapper = createMapper(opts, ctx);

    return new Transform({
        objectMode: true,
        transform(data, encoding, callback) {
            try {
                callback(null, mapper(data));
            }
            catch (err) {
                callback(err);
            }
        }
    });
}
