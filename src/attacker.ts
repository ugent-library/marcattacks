import log4js from 'log4js';
import { loadPlugin } from './plugin-loader.js';
import { sftpLatestFile, sftpReadStream , sftpWriteStream } from './stream/sftpstream.js';
import { httpReadStream } from './stream/httpstream.js';
import { Readable } from 'stream';
import { pathToFileURL } from "node:url";
import { type Transform, type Writable } from 'node:stream';
import { SlowWritable } from './stream/slow-writable.js';
import path from "node:path";
import fs from 'fs';
import { s3LatestObject, s3ReadStream, s3WriteStream } from './stream/s3stream.js';
import { pipeline } from 'node:stream/promises';
import { 
    createCountableSkippedStream, 
    createUntarredStream, 
    createUncompressedStream,
    createVerboseStream 
} from './util/stream_helpers.js';
import { fileLatestFile, fileReadStream } from './stream/filestream.js';

const logger = log4js.getLogger();

export class PipelineError extends Error {
    public readonly statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;

        Object.setPrototypeOf(this, PipelineError.prototype);

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export async function createInputReadStream(url: string, opts: any): Promise<{ stream: Readable; resolvedUrl: URL }> {
    let inputFile: URL;

    if (fs.existsSync(url)) {
        const filePath = path.resolve(process.cwd(), url);
        inputFile = pathToFileURL(filePath);
    } else {
        inputFile = new URL(url);
    }

    logger.info(`using: ${getCleanURL(inputFile)}`);

    let readableStream: Readable;

    if (inputFile.protocol.startsWith("http")) {
        readableStream = await httpReadStream(inputFile.toString());
    } else if (inputFile.protocol.startsWith("s3")) {
        const url = new URL(inputFile);

        if (process.env.S3_ACCESS_KEY) {
            url.username = process.env.S3_ACCESS_KEY;
        }

        if (process.env.S3_SECRET_KEY) {
            url.password = process.env.S3_SECRET_KEY;
        }

        inputFile = await s3LatestObject(url, opts);
        readableStream = await s3ReadStream(inputFile, opts);
    } else if (inputFile.protocol === 'sftp:') {
        const url = new URL(inputFile);

        if (process.env.SFTP_USERNAME) {
            url.username = process.env.SFTP_USERNAME;
        }

        if (process.env.SFTP_PASSWORD) {
            url.password = process.env.SFTP_PASSWORD;
        }

        inputFile = await sftpLatestFile(url, opts);
        readableStream = await sftpReadStream(inputFile, opts);
    } else if (inputFile.protocol === 'stdin:') {
        readableStream = process.stdin;
    } else {
        inputFile = await fileLatestFile(inputFile);
        readableStream = await fileReadStream(inputFile);
    }

    return { stream: readableStream, resolvedUrl: inputFile };
}

export async function createDecompressionStage(opts: any, inputFile: URL): Promise<Transform | null> {
    if (opts.z || inputFile.pathname.endsWith(".gz")) {
        return createUncompressedStream();
    }
    return null;
}

export async function createUntarStage(opts: any, inputFile: URL): Promise<Transform | null> {
    if (opts.tar || inputFile.pathname.match(/.tar(.\w+$)?$/) || inputFile.pathname.endsWith(".tgz")) {
        return await createUntarredStream();
    }
    return null;
}

export async function createInputTransformStage(opts: any, inputFile: URL, firstStream: Readable): Promise<Transform> {
    if (!opts.from) {
        console.error(`Need --from`);
        process.exit(1);
    }

    const mod = await loadPlugin(opts.from, 'input');
    const transformer = await mod.transform(Object.assign({ path: inputFile }, opts.param));
    
    transformer.on('error', (error: any) => {
        if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
            firstStream?.destroy();
        } else {
            logger.error("input stream processing error: ", error.message);
            firstStream?.destroy();
            process.exitCode = 2;
        }
    });
    transformer.on('finish', () => logger.debug('writeable finished'));
    transformer.on('end', () => logger.debug('readable ended'));
    transformer.on('close', () => logger.debug('stream closed'));
    
    return transformer;
}

export async function createCountSkipStage(opts: any): Promise<Transform | null> {
    if (opts.count || opts.skip) {
        return createCountableSkippedStream(opts.count, opts.skip);
    }
    return null;
}

export async function createMapTransformStage(opts: any): Promise<Transform | null> {
    if (opts.map) {
        const mod = await loadPlugin(opts.map, 'transform');
        return await mod.transform(opts.param);
    }
    return null;
}

export async function createOutputWriteStream(opts: any): Promise<Writable> {
    if (isWritableStream(opts.out)) {
        return opts.out;
    }
    
    if (opts.out === '@slow') {
        return new SlowWritable({ delayMs: 100 });
    }
    
    if (opts.out === '@errors') {
        return new SlowWritable({ simulateErrorEveryN: 2 });
    }
    
    if (opts.out) {
        if (opts.out.startsWith("sftp")) {
            const url = new URL(opts.out);
            
            if (process.env.SFTP_USERNAME) {
                url.username = process.env.SFTP_USERNAME;
            }

            if (process.env.SFTP_PASSWORD) {
                url.password = process.env.SFTP_PASSWORD;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await sftpWriteStream(url, opts);
        }
        
        if (opts.out.startsWith("s3")) {
            const url = new URL(opts.out);

            if (process.env.S3_ACCESS_KEY) {
                url.username = process.env.S3_ACCESS_KEY;
            }

            if (process.env.S3_SECRET_KEY) {
                url.password = process.env.S3_SECRET_KEY;
            }

            logger.info(`put ${getCleanURL(url)}`);
            return await s3WriteStream(url, {});
        }
        
        return fs.createWriteStream(opts.out, { encoding: 'utf-8' });
    }
    
    return process.stdout;
}

export async function createOutputTransformStage(opts: any): Promise<Transform | null> {
    if (opts.to) {
        const mod = await loadPlugin(opts.to, 'output');
        return await mod.transform(opts.param);
    }
    return null;
}

export async function attack(url: string, opts: any): Promise<number> {
    let result = 0;
    try {
        const { stream: readableStream, resolvedUrl: inputFile } = await createInputReadStream(url, opts);
        const stages: (Readable | Transform | Writable)[] = [readableStream];

        // Add decompression stage if needed
        const decompressionStage = await createDecompressionStage(opts, inputFile);
        if (decompressionStage) stages.push(decompressionStage);

        // Add untar stage if needed
        const untarStage = await createUntarStage(opts, inputFile);
        if (untarStage) stages.push(untarStage);

        // Add input transform stage (required)
        const inputTransform = await createInputTransformStage(opts, inputFile, readableStream);
        stages.push(inputTransform);

        // Add count/skip stage if needed
        const countSkipStage = await createCountSkipStage(opts);
        if (countSkipStage) stages.push(countSkipStage);

        // Add verbose stream (always included)
        const verboseStream = createVerboseStream();
        stages.push(verboseStream);

        // Add map transform stage if needed
        const mapStage = await createMapTransformStage(opts);
        if (mapStage) stages.push(mapStage);

        // Add output transform stage if needed
        const outputTransform = await createOutputTransformStage(opts);
        if (outputTransform) {
            stages.push(outputTransform);
            
            // Add output write stream
            const outStream = await createOutputWriteStream(opts);
            stages.push(outStream);
            
            try {
                await pipeline(stages);
                result = verboseStream.getCount();
                logger.info("pipeline finished cleanly");
            } catch (err: any) {
                result = verboseStream.getCount();

                if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    logger.info("stream closed by limiter.");
                } else {
                    logger.error("pipeline error:", err);
                    throw new PipelineError(err.message, 3);
                }
            }
        }
    } catch (e) {
        if (e instanceof PipelineError) {
            throw e;
        } else {
            logger.error(`process crashed with: ${e}`);
            throw e;
        }
    }
    return result;
}

function getCleanURL(url: URL): URL {
    const tempUrl = new URL(url.href);
    tempUrl.username = '***';
    tempUrl.password = '***';
    return tempUrl;
}

function isWritableStream(obj: any): boolean {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.write === 'function' &&
        typeof obj.end === 'function' &&
        obj.writable !== false
    );
}