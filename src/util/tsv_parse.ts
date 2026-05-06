import { Readable } from "stream";
import { parse } from '@fast-csv/parse';

export async function parseStream(readable: Readable): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];

    readable
      .pipe(
        parse({
          delimiter: "\t",
          headers: true,
          trim: true,
          ignoreEmpty: true,
        })
      )
      .on("error", reject)
      .on("data", (row: Record<string, string>) => {
        rows.push(row);
      })
      .on("end", () => {
        resolve(rows);
      });
  });
}