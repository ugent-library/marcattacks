import { Transform } from 'stream';
import { stringify, type Options as CsvStringifyOptions } from 'csv-stringify';
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function transform(opts: { header: string, delimiter?: string }): Promise<Transform> {
    const delimiter: string = opts['delimiter'] ?? ',';

    let stringifier: ReturnType<typeof stringify> | null = null;
    let sortedKeys: string[];

    return new Transform({
        objectMode: true,
        transform(data: any, _encoding, callback) {
            if (Object.keys(data).length === 0) {
                logger.debug('skipped empty record');
                callback();
                return;
            }

            // Initialise the stringifier on the first record
            if (!stringifier) {
                sortedKeys = Object.keys(data).sort();

                stringifier = stringify({
                    delimiter,
                    columns: sortedKeys,
                    header: opts.header !== 'no',
                    cast: {
                        object: (value) =>
                            Array.isArray(value)
                                ? `ARRAY[${value.length}]`
                                : `HASH[${Object.keys(value).length}]`,
                    },
                } satisfies CsvStringifyOptions);

                stringifier.on('data', (chunk) => this.push(chunk));
                stringifier.on('error', (err) => this.destroy(err));
            }

            const record: Record<string, unknown> = {};
            for (const key of sortedKeys) {
                record[key] = data[key];
            }

            logger.trace(`writing record with ${sortedKeys.length} fields`);
            stringifier.write(record, _encoding, callback);
        },

        flush(callback) {
            if (stringifier) {
                stringifier.end();
                stringifier.once('finish', callback);
            } else {
                callback();
            }
        },
    });
}