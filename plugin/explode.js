import { Transform } from 'stream';

// Demo fan-out (1-to-many) map: explodes each MARC record into one output row
// per field. It is the reference example for the worker pool's fan-out path.
//
// A fan-out plugin opts in with these exports:
//   export const fanOut = true       -> the worker pool flattens the rows[] the
//                                       mapper returns into the output stream
//                                       (without it the array is treated as a
//                                       single record).
//   export const autoParallel = true -> (optional) thread under `--workers auto`
//                                       as well as an explicit `--workers N`.
//   export createMapper(opts, ctx)   -> a pure record -> rows[] mapper, run both
//                                       in-process and on worker threads. Without
//                                       it a map is "not parallelizable" and
//                                       --workers is ignored.
//
// ctx.utils is the same context passed to transform(), so marcmap & friends are
// available on worker threads without importing internals.

export const fanOut = true;
export const autoParallel = true;

export function createMapper(opts, ctx) {
    const { marcmap } = ctx.utils;
    return (data) => explode(data, marcmap);
}

// Pure record -> rows[] mapper. All the work lives here so it behaves
// identically in-process (transform, below) and on a worker thread (the pool
// calls createMapper directly).
function explode(data, marcmap) {
    const record = data['record'];
    const id = marcmap(record, "001")[0];
    const rows = [];

    for (let i = 0; i < record.length; i++) {
        const field = record[i];
        const tag   = field[0];
        const ind1  = field[1];
        const ind2  = field[2];

        // Join the field's values: the controlfield value, or all subfield
        // values. Rows are [tag, ind1, ind2, code, value, code, value, ...],
        // so values live at the odd indices from 4.
        let value = "";
        for (let j = 4; j < field.length; j += 2) {
            if (value !== "") value += " ";
            value += field[j];
        }

        // For datafields (tag 1xx-9xx) also expose the subfields as code/value
        // pairs; controlfields (LDR, 00x) have none.
        let subfields = null;
        if (/^[1-9]/.test(tag)) {
            subfields = [];
            for (let j = 3; j < field.length; j += 2) {
                subfields.push({ code: field[j], value: field[j + 1] });
            }
        }

        rows.push({
            record_id: id,
            field_seq: i,
            tag,
            ind1,
            ind2,
            value,
            subfields,
        });
    }

    return rows;
}

// Serial path (no --workers, or a non-parallelizable run): wrap the same mapper
// and flatten its rows[] into the stream, mirroring what the pool does.
export function transform(opts, ctx) {
    const mapper = createMapper(opts, ctx);

    return new Transform({
        objectMode: true,
        transform(data, _encoding, callback) {
            try {
                for (const row of mapper(data)) {
                    this.push(row);
                }
                callback(null);
            } catch (err) {
                callback(err);
            }
        },
    });
}
