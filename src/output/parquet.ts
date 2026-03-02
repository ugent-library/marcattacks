import { Transform } from 'stream';
import { ParquetSchema, ParquetTransformer } from '@dsnp/parquetjs';
import fs from 'fs';

/**
 * Transforms an input stream of objects into a Parquet-formatted byte stream.
 * @param param - Configuration or Schema definition
 */
export async function transform(opts: { schema: string }): Promise<Transform> {
    const schema : ParquetSchema = 
        typeof opts.schema === "string" ? 
            new ParquetSchema(JSON.parse(fs.readFileSync(opts.schema, { encoding: "utf-8"}))) 
            : new ParquetSchema(opts.schema);
  
  const transformer = new ParquetTransformer(schema);

  return transformer;
}