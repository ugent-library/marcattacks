import { Transform } from 'stream';
import { ParquetSchema, ParquetTransformer } from '@dsnp/parquetjs';
import fs from 'fs';

/**
 * Transforms an input stream of objects into a Parquet-formatted byte stream.
 * @param param - Configuration or Schema definition
 */
export async function transform(param: any): Promise<Transform> {
    const schema : ParquetSchema = 
        typeof param.schema === "string" ? 
            new ParquetSchema(JSON.parse(fs.readFileSync(param.schema, { encoding: "utf-8"}))) 
            : new ParquetSchema(param.schema);
  
  const transformer = new ParquetTransformer(schema);

  return transformer;
}