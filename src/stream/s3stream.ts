import { 
    S3Client, 
    GetObjectCommand,
    PutObjectCommand, 
    UploadPartCommand, 
    CreateMultipartUploadCommand, 
    CompleteMultipartUploadCommand, 
    paginateListObjectsV2,
    type _Object,
    type S3ClientConfig
} from "@aws-sdk/client-s3";
import { Readable, Writable } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();
type S3Config = {
    region: string;
    endpoint: string;
    bucket: string;
    key: string;
    accessKeyId?: string;
    secretAccessKey?: string;
};

export async function s3ReadStream(url: URL, options: { range?: string }): Promise<Readable> {
    const config = parseURL(url);

    logger.debug(`s3 config:`,config);

    const bucket = config.bucket;
    const key    = config.key;
    const range  = options.range;
    const s3 = makeClient(config);

    const res = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: range,
    }));

    const body = res.Body;

    if (!body) {
        throw new Error("S3 GetObject returned an empty body");
    }

    // 1) If SDK returned a Node.js readable stream (typical in Node)
    if (isNodeReadable(body)) {
        return body as Readable;
    }

    // 2) If SDK returned a WHATWG ReadableStream (browser-ish or newer runtimes)
    if (isReadableStream(body)) {
        // Node.js v17+ has Readable.fromWeb
        // Fallback: wrap async iterator
        if (typeof (Readable as any).fromWeb === "function") {
        return (Readable as any).fromWeb(body as ReadableStream<Uint8Array>);
        } else {
        // Convert using async iterator produced by the stream
        const reader = (body as ReadableStream<Uint8Array>).getReader();
        const nodeStream = new Readable({
            read() {
                // no-op. We'll push from async loop below
            }
        });
        (async () => {
            try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                nodeStream.push(Buffer.from(value));
            }
            nodeStream.push(null);
            } catch (err) {
            nodeStream.destroy(err as Error);
            }
        })();
        return nodeStream;
        }
    }

    // 3) If SDK returned a Blob (browsers)
    if (typeof Blob !== "undefined" && body instanceof Blob) {
        const stream = (body as Blob).stream();
        if (typeof (Readable as any).fromWeb === "function") {
            return (Readable as any).fromWeb(stream);
        }
        // fallback same as above
        const reader = stream.getReader();
        const nodeStream = new Readable({
        read() {}
        });
        (async () => {
        try {
            while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            nodeStream.push(Buffer.from(value));
            }
            nodeStream.push(null);
        } catch (err) {
            nodeStream.destroy(err as Error);
        }
        })();
        return nodeStream;
    }

    // 4) If it's an async iterable (some runtimes)
    if (isAsyncIterable(body)) {
        return Readable.from(body as AsyncIterable<Uint8Array | string | Buffer>);
    }

    // Unknown body shape
    throw new Error("Unsupported S3 GetObject body type");
}

export function s3WriteStream(url: URL, options: { partSize?: number;}) : Promise<Writable> {
    return new Promise<Writable>( (resolve) => {
        const config = parseURL(url);

        logger.debug(`s3 config:`, config);
        const bucket = config.bucket;
        const key = config.key;
        const s3 = makeClient(config);
        const partSize = options.partSize ?? 5 * 1024 * 1024;

        let uploadId: string | null = null;
        let parts: Array<{ ETag: string | undefined; PartNumber: number }> = [];
        let buffer = Buffer.alloc(0);
        let partNumber = 1;

        const writer = new Writable({
            async write(chunk, _encoding, callback) {
                logger.debug("write chunk...");
                try {
                    buffer = Buffer.concat([buffer, chunk]);

                    if (buffer.length >= partSize) {
                        await flushPart();
                    }
                    callback();
                } catch (err) {
                    callback(err as Error);
                }
            },

            async final(callback) {
                logger.debug("final...");
                try {
                    logger.debug("flushPart...");
                    await flushPart(true);
                    logger.debug("finishUpload...");
                    await finishUpload();
                    callback();
                } catch (err) {
                    callback(err as Error);
                }
            }
        });

        async function ensureUpload() {
            if (!uploadId) {
                const res = await s3.send(new CreateMultipartUploadCommand({
                    Bucket: bucket,
                    Key: key
                }));
                uploadId = res.UploadId!;
            }
        }

        async function flushPart(isLast = false) {
            if (buffer.length === 0 && !isLast) return;

            logger.debug("ensureUpload...");
            await ensureUpload();

            logger.debug("s3.send...");
            const res = await s3.send(new UploadPartCommand({
                Bucket: bucket,
                Key: key,
                PartNumber: partNumber,
                UploadId: uploadId!,
                Body: buffer
            }));

            parts.push({ ETag: res.ETag, PartNumber: partNumber });
            buffer = Buffer.alloc(0);
            partNumber++;
        }

        async function finishUpload() {
            if (!uploadId) {
                // No parts written, upload empty object
                await s3.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: Buffer.alloc(0)
                }));
                return;
            }

            await s3.send(new CompleteMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId!,
                MultipartUpload: { Parts: parts }
            }));
        }

        resolve(writer);
    });
}

export async function s3LatestObject(url: URL, opts: any): Promise<URL> {
    if (! url.href.includes("@latest:")) {
        return url; 
    }

    const bucket = url.pathname.replaceAll(/@latest:.*/g,"");
    const extension = url.pathname.replaceAll(/.*@latest:/g,"");

    const config = parseURL(url);

    const s3Client = new S3Client(config);

    const paginatorConfig = {
        client: s3Client,
        pageSize: 1000
    };

    const commandInput = {
        Bucket: bucket,
        // Optional: Prefix: 'uploads/' 
    };

    try {
        let latestFile: _Object | null = null;
        const targetExt = extension.toLowerCase();

        // Iterate through all pages of the bucket
        for await (const page of paginateListObjectsV2(paginatorConfig, commandInput)) {
            const contents = page.Contents || [];
            
            for (const obj of contents) {
                // Filter by extension
                if (obj.Key?.toLowerCase().endsWith(targetExt)) {
                    // Compare timestamps to keep only the newest
                    if (!latestFile || (obj.LastModified! > latestFile.LastModified!)) {
                        latestFile = obj;
                    }
                }
            }
        }

        if (!latestFile || !latestFile.Key) {
            throw new Error(`No file with extension "${extension}" found in bucket "${bucket}".`);
        }

        const url_parts : string[] = [];

        url_parts.push(url.protocol);
        url_parts.push('//');
        if (url.username) {
            url_parts.push(url.username);
            if (url.password) {
                url_parts.push(':')
                url_parts.push(url.password);
            }
            url_parts.push('@');
        } 
        url_parts.push(url.hostname);
        if (!(url.port === "80" || url.port === "443")) {
            url_parts.push(':');
            url_parts.push(url.port);
        }
        url_parts.push(bucket + '/' + latestFile.Key);

        logger.trace(`resolved as ${url_parts.join("")}`);
        return new URL(url_parts.join(""));
    } catch (error) {
        console.error("Error finding latest S3 file:", error);
        throw error;
    }
}

function isNodeReadable(x: any): x is Readable {
    return x && typeof x.pipe === "function" && typeof x.read === "function";
}

function isReadableStream(x: any): x is ReadableStream {
    return typeof x?.getReader === "function";
}

function isAsyncIterable(x: any): x is AsyncIterable<any> {
    return x && typeof x[Symbol.asyncIterator] === "function";
}

function makeClient(config: S3Config) : S3Client {
    logger.debug(config);
    const myConfig : S3ClientConfig = {
        endpoint: config.endpoint,
        forcePathStyle: true,
        region: config.region,
    };

    if (config.accessKeyId && config.secretAccessKey) {
        myConfig.credentials = {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        };
    }
    return new S3Client(myConfig);
}

function parseURL(url: URL) : S3Config {
    const config : S3Config = {
        region: "us-east-1",
        endpoint: "http://localhost:3371",
        bucket: "bbl",
        key: "test.txt"
    };
    
    const scheme = url.protocol.startsWith("s3s") ? "https" : "http";
    config.endpoint = `${scheme}://${url.hostname}`;
    if (url.port) {
        config.endpoint += `:${url.port}`;
    }
    config.bucket = url.pathname.split("/")[1] ?? "";
    config.key = url.pathname.split("/").splice(2).join("/");

    if (url.username) {
        config.accessKeyId = url.username;
    }
    
    if (url.password) {
        config.secretAccessKey = url.password;
    }

    return config;
}