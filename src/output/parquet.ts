import { Transform } from 'stream';
import { ParquetSchema, ParquetTransformer } from '@dsnp/parquetjs';
import fs from 'fs';

/**
 * Transforms an input stream of objects into a Parquet-formatted byte stream.
 *
 * Memory note: the parquet writer keeps two kinds of state while it runs.
 *  - a live "row buffer" of `rowGroupSize` rows, flushed to disk per row group
 *    (bounded, but proportional to how much data each record carries);
 *  - the file footer metadata, which lists every row group and is held in
 *    memory until the file is closed (grows with the size of the input).
 * We disable the optional page index by default: @dsnp/parquetjs builds a
 * columnIndex/offsetIndex for every row group and retains it in that footer
 * metadata until close, so on a large input it inflates memory for a read-time
 * optimization most readers never use. Dropping it lowers steady-state memory
 * (~10-15% in practice) and the resulting file is still a valid parquet file.
 *
 * @param opts - param bag from --param: `schema` (path or definition),
 *   optional `rowGroupSize`, and optional `pageIndex` to re-enable the index.
 */
export async function transform(opts: { schema: string; rowGroupSize?: string | number; pageIndex?: string | boolean }): Promise<Transform> {
    if (opts.schema == null) {
        throw new Error(
            "parquet output requires a `schema` param (e.g. --param schema=/path/to/schema.json)"
        );
    }

    const schema : ParquetSchema =
        typeof opts.schema === "string" ?
            new ParquetSchema(JSON.parse(fs.readFileSync(opts.schema, { encoding: "utf-8"})))
            : new ParquetSchema(opts.schema);

    // @dsnp/parquetjs builds a schema with zero fields silently and only throws
    // ("cannot write parquet file with zero fieldList") at footer-write time —
    // i.e. after the whole input has streamed through and been dropped. Catch an
    // empty field set here so we fail fast with an actionable message instead of
    // churning through millions of records first.
    if (schema.fieldList.length === 0) {
        const where = typeof opts.schema === "string" ? ` (from ${opts.schema})` : "";
        throw new Error(
            `parquet schema${where} defines no fields; check that the schema is a non-empty ` +
            "map of column definitions, e.g. {\"id\":{\"type\":\"UTF8\"}}"
        );
    }

  const writerOpts: { pageIndex: boolean; rowGroupSize?: number } = {
    pageIndex: parseBool(opts.pageIndex, false),
  };

  const rgs = opts.rowGroupSize != null ? Number(opts.rowGroupSize) : undefined;
  if (rgs !== undefined && Number.isFinite(rgs) && rgs > 0) {
    writerOpts.rowGroupSize = rgs;
  }

  const transformer = new ParquetTransformer(schema, writerOpts);

  return transformer;
}

function parseBool(value: string | boolean | undefined, dflt: boolean): boolean {
  if (value === undefined || value === null) return dflt;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
