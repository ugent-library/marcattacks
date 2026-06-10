// Worker thread: runs a parallelizable map (e.g. jsonata, fix) on batches of
// records. The heavy per-record work (jsonata evaluate / fix chain) runs here;
// the main thread does I/O, parsing and serialization.
//
// Protocol:
//   main -> worker : { seq, batch: record[] }
//   worker -> main : { ready: true }                         (once, on startup)
//                    { seq, mapped: (record|null)[] }        (null = rejected)
//                    { seq, error: string }
import { parentPort, workerData } from 'node:worker_threads';
import { loadPlugin } from './plugin-loader.js';
import * as marcUtils from './marcmap.js';
import { REJECT } from 'catmandu-fix-js';

const { map, param } = workerData as { map: string; param: any };

const mod = await loadPlugin(map, 'transform');
if (typeof mod.createMapper !== 'function') {
    throw new Error(`map '${map}' is not parallelizable (no createMapper)`);
}
// createMapper gets the same { utils } context as transform(), so a plugin can
// reach marcmap & friends on a worker thread without importing internals.
const mapper: (data: any) => any = await mod.createMapper(param ?? {}, { utils: marcUtils });

parentPort!.postMessage({ ready: true });

parentPort!.on('message', async (msg: { seq: number; batch: any[] }) => {
    try {
        const mapped: any[] = [];
        for (const rec of msg.batch) {
            const r = await mapper(rec);
            mapped.push(r === REJECT ? null : r);   // null marks a dropped record
        }
        parentPort!.postMessage({ seq: msg.seq, mapped });
    } catch (err: any) {
        parentPort!.postMessage({ seq: msg.seq, error: err?.message ?? String(err) });
    }
});
