import { Transform } from 'stream';

// z00r explodes each MARC record into one row per field (1 record -> many
// rows). To run under `--workers` it opts into the worker pool's fan-out path:
//
//   export const fanOut = true   -> the pool flattens the array of rows the
//                                   mapper returns into the output stream
//   export createMapper(opts,ctx) -> a pure record -> rows[] mapper, run both
//                                   in-process and on worker threads
//
// Without createMapper a map is "not parallelizable" and --workers is ignored.
export const fanOut = true;

// Thread under the default `--workers auto`, not just an explicit `--workers N`.
export const autoParallel = true;

// Pure record -> rows[] mapper. All the work lives here so it is identical
// whether it runs in-process (transform, below) or on a worker thread (the
// pool calls createMapper directly). ctx.utils is the same context passed to
// transform(), so marcmap & friends are available on worker threads too.
export function createMapper(opts, ctx) {
    const { marcmap } = ctx.utils;
    return (data) => explode(data, marcmap);
}

function explode(data, marcmap) {
    const record = data['record'];
    const id = marcmap(record, "001")[0];
    const rows = [];

    for (let i = 0; i < record.length; i++) {
        const field = record[i];
        const tag   = field[0];
        const ind1  = field[1];
        const ind2  = field[2];
        let value   = "";

        if (tag.match(/^LDR|\d{3}$/)) {
            for (let j = 3; j < field.length; j += 2) {
                if (value != "") {
                    value += " ";
                }
                if (field[j] === '_') {
                    value += field[j + 1];
                }
                else {
                    value += field[j + 1];
                }
            }
        }
        else {
            value = null;
        }

        let subf = [];

        if (tag.match(/^[123456789]/)) {
            for (let j = 3; j < field.length; j += 2) {
                subf.push({ code: field[j], value: field[j + 1] });
            }
        }
        else {
            subf = null;
        }

        rows.push({
            "record_id": id,
            "field_seq": i,
            "tag": tag,
            "ind1": ind1,
            "ind2": ind2,
            "value": value,
            "subfields": subf
        });
    }

    return rows;
}

// Serial path (no --workers / non-parallelizable run): wrap the same mapper and
// flatten its rows[] into the stream, mirroring what the pool does on its side.
export function transform(opts, ctx) {
    const mapper = createMapper(opts, ctx);

    return new Transform({
        objectMode: true,
        transform(data, encoding, callback) {
            try {
                for (const row of mapper(data)) {
                    this.push(row);
                }
                callback(null);
            }
            catch (err) {
                callback(err);
            }
        }
    });
}
