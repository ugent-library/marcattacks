// Isolated benchmark for the XML input stage only.
// Usage: node bench-xml-input.mjs <impl> <file>
//   impl: path to a module exporting `transform(opts)` returning a Transform
// Pipes file -> xml transform -> counting sink. Reports time, records,
// throughput, peak RSS and whether RSS stayed flat (samples every 100ms).
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const impl = process.argv[2];
const file = process.argv[3];

const mod = await import(impl);

// sample memory to detect growth (not just peak)
let peakRSS = 0, peakHeap = 0;
const samples = [];
const timer = setInterval(() => {
    const m = process.memoryUsage();
    peakRSS = Math.max(peakRSS, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    samples.push(m.rss);
}, 100);

let count = 0;
const sink = new Writable({
    objectMode: true,
    write(_rec, _enc, cb) { count++; cb(); }
});

const xform = await mod.transform({});
const t0 = process.hrtime.bigint();
await pipeline(fs.createReadStream(file), xform, sink);
const t1 = process.hrtime.bigint();
clearInterval(timer);

const ms = Number(t1 - t0) / 1e6;
const mb = (b) => (b / 1048576).toFixed(1);
// flatness: max sample / median sample of the second half (steady state)
const half = samples.slice(Math.floor(samples.length / 2));
half.sort((a, b) => a - b);
const med = half[Math.floor(half.length / 2)] || 0;
const drift = med ? (peakRSS / med) : 0;

console.log(JSON.stringify({
    impl: impl.split('/').pop(),
    records: count,
    ms: +ms.toFixed(0),
    recPerSec: +(count / (ms / 1000)).toFixed(0),
    peakRSS_MB: +mb(peakRSS),
    peakHeap_MB: +mb(peakHeap),
    steadyMedianRSS_MB: +mb(med),
    peakOverSteady: +drift.toFixed(2),
}));
