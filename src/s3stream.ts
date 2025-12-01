import { 
    S3Client, 
    PutObjectCommand, 
    UploadPartCommand, 
    CreateMultipartUploadCommand, 
    CompleteMultipartUploadCommand, 
    type S3ClientConfig
} from "@aws-sdk/client-s3";
import { Writable } from "stream";
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

export function s3WriterStream(url: URL, options: { partSize?: number;}) : Promise<Writable> {
    return new Promise<Writable>( (resolve) => {
        const config = parseURL(url);

        logger.debug(`s3 config`, config);
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
                try {
                    await flushPart(true);
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

            await ensureUpload();

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

function makeClient(config: S3Config) : S3Client {
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
    
    config.endpoint = `http://${url.hostname}:${url.port}`;
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