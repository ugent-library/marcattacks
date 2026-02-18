import { describe, test, expect } from "@jest/globals";
import { 
    createCountableSkippedStream,
    createVerboseStream,
    getCleanURL,
    getStrippedURL,
    createUncompressedStream,
    createUntarredStream,
    type VerboseStream
} from "../../dist/util/stream_helpers.js"; 
import { Readable } from 'node:stream';
import { gzipSync } from 'zlib';
import tar from 'tar-stream';

const data : any = [];
const json =  { "record": [ ] };

for (let i = 0 ; i < 100 ; i++ ) {
    data.push(json);
}

describe("util/stream_helpers", () => {
    test("transform creates skippable stream", async () => {
        const transformer = createCountableSkippedStream(undefined,10);

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data, { objectMode: true }).pipe(transformer);
        });

        expect(results.length).toBe(90);
    });

    test("transform creates countable stream", async () => {
        const transformer = createCountableSkippedStream(10,10);

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data, { objectMode: true }).pipe(transformer);
        });

        expect(results.length).toBe(10);
    });

    test("transform creates verbose stream", async () => {
        const transformer = createVerboseStream() as VerboseStream;

        const results: string[] = [];
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => results.push(chunk));
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(data, { objectMode: true }).pipe(transformer);
        });

        expect(transformer.getCount()).toBe(100);
    });

    test("transform creates unzipped stream", async () => {
        const inputString = "hello world";
        const gzippedInput = gzipSync(inputString);

        const transformer = createUncompressedStream();

        let result: string = "";
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => {
                result += chunk.toString()
            });
            transformer.on('end', resolve);
            transformer.on('error', reject);
            Readable.from(gzippedInput).pipe(transformer);
        });

        expect(result).toBe(inputString);
    });

    test("transform creates untarred stream", async () => {
        const inputString = "hello world";
        const pack = tar.pack();
        pack.entry({ name: 'my-test.txt' }, inputString);
        pack.finalize(); // close the archive so the stream ends

        const transformer = await createUntarredStream();

        let result: string = "";
    
        await new Promise((resolve, reject) => {
            transformer.on('data', (chunk: any) => {
                result += chunk.toString()
            });
            transformer.on('end', resolve);
            transformer.on('error', reject);
            pack.pipe(transformer);
        });

        expect(result).toBe(inputString);
    });

    test("create a clean URL", () => {
        const clean = getCleanURL(new URL("https://foo:bar@example.org/"));
        expect(clean.href).toBe("https://***:***@example.org/");
    });

    test("create a stripped URL", () => {
        const stripped = getStrippedURL(new URL("https://foo:bar@example.org/"));
        expect(stripped.href).toBe("https://example.org/");
    });
});