// Compare two XML input impls for IDENTICAL record output on a file.
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

async function collect(implPath, file) {
    const mod = await import(implPath);
    const out = [];
    const sink = new Writable({ objectMode: true, write(r, _e, cb) { out.push(r.record); cb(); } });
    await pipeline(fs.createReadStream(file, { highWaterMark: 1 << 16 }), await mod.transform({}), sink);
    return out;
}

const [a, b, file] = [process.argv[2], process.argv[3], process.argv[4]];
const ra = await collect(a, file);
const rb = await collect(b, file);

if (ra.length !== rb.length) {
    console.log(`MISMATCH: record count ${ra.length} vs ${rb.length}`);
    process.exit(1);
}
let diffs = 0;
for (let i = 0; i < ra.length; i++) {
    const sa = JSON.stringify(ra[i]), sb = JSON.stringify(rb[i]);
    if (sa !== sb) {
        if (diffs < 5) {
            console.log(`--- record ${i} differs ---`);
            console.log('A:', sa.slice(0, 400));
            console.log('B:', sb.slice(0, 400));
        }
        diffs++;
    }
}
console.log(diffs === 0
    ? `OK: ${ra.length} records identical`
    : `MISMATCH: ${diffs}/${ra.length} records differ`);
process.exit(diffs === 0 ? 0 : 1);
