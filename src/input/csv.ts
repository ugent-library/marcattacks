import { Transform, type TransformCallback } from "stream";
import { parse, type Options as CsvParseOptions } from "csv-parse";

export async function transform(opts: { delimiter?: string }): Promise<Transform> {
    const delimiter: string = opts['delimiter'] ?? ",";

    const parser = parse({
        delimiter,
        columns: true,        // Use first row as header keys
        skip_empty_lines: true,
        trim: false,          // Match original behaviour — no implicit trimming
        relax_column_count: false,
    } satisfies CsvParseOptions);

    return parser as unknown as Transform;
}