import { Transform } from 'stream';

/**
 * Example transform plugin.
 *
 * Plugins receive two arguments:
 *   - opts: values passed via `--param key=value` on the CLI
 *   - ctx:  context injected by marcattacks. `ctx.utils` exposes the
 *           marc helpers (marcmap, marctag, marcind, marcForEachTag,
 *           marcForEachSub, marcsubfields) so the plugin does not need
 *           to import marcattacks itself. This makes the plugin work
 *           when marcattacks is installed globally on a server.
 *
 * Invoke with:
 *   marcattacks --from alephseq --map ./plugin/demo.js --to jsonl input.seq
 */
export function transform(opts, ctx) {
    const { marcmap } = ctx.utils;

    return new Transform({
        objectMode: true,
        transform(data, encoding, callback) {
            const record = data['record'];

            data['id']     = marcmap(record, "001")[0] ?? "UNKNOWN";
            data['titles'] = marcmap(record, "245abc");
            data['isbn']   = marcmap(record, "020a");

            delete data['record'];

            callback(null, data);
        }
    });
}
