import log4js from 'log4js';
import { loadPlugin } from './plugin-loader.js';
import { sftpLatestFile, sftpReadStream , sftpWriteStream } from './sftpstream.js';
import { httpReadStream } from './httpstream.js';
import { Readable } from 'stream';
import { pathToFileURL } from "node:url";
import { type Transform, type Writable } from 'node:stream';
import { SlowWritable } from './slow-writable.js';
import path from "node:path";
import fs from 'fs';
import { s3LatestObject, s3ReadStream, s3WriteStream } from './s3stream.js';
import { pipeline } from 'node:stream/promises';
import { 
    createCountableSkippedStream, 
    createUntarredStream, 
    createUncompressedStream,
    createVerboseStream 
} from './util/stream_helpers.js';
import { fileLatestFile, fileReadStream } from './filestream.js';

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

export async function attack(url: string, opts: any) : Promise<number> {
    let result = 0;
    try {
        let inputFile : URL;

        if (fs.existsSync(url)) {
            const filePath = path.resolve(process.cwd(), url);
            inputFile = pathToFileURL(filePath);
        }
        else {
            inputFile = new URL(url);
        }

        logger.info(`using: ${getCleanURL(inputFile)}`);

        let readableStream : Readable;
        
        if (inputFile.protocol.startsWith("http")) {
            readableStream = await httpReadStream(inputFile.toString());
        }
        else if (inputFile.protocol.startsWith("s3")) {
            const url = new URL(inputFile);

            if (process.env.S3_ACCESS_KEY) {
                url.username = process.env.S3_ACCESS_KEY;
            }

            if (process.env.S3_SECRET_KEY) {
                url.password = process.env.S3_SECRET_KEY;
            }

            // optional resolve @latest
            inputFile = await s3LatestObject(url,opts);
            readableStream = await s3ReadStream(inputFile,opts);
        }
        else if (inputFile.protocol === 'sftp:') {
            const url = new URL(inputFile);

            if (process.env.SFTP_USERNAME) {
                url.username = process.env.SFTP_USERNAME;
            }

            if (process.env.SFTP_PASSWORD) {
                url.password = process.env.SFTP_PASSWORD;
            }

            // optional resolve @latest
            inputFile = await sftpLatestFile(url,opts);
            readableStream = await sftpReadStream(inputFile,opts);
        }
        else if (inputFile.protocol === 'stdin:') {
            readableStream = process.stdin;
        }
        else {
            inputFile = await fileLatestFile(inputFile);
            readableStream = await fileReadStream(inputFile);
        }

        const stages: (Readable | Transform | Writable)[] = [readableStream];

        if (opts.z || inputFile.pathname.endsWith(".gz")) {
            stages.push(createUncompressedStream()); 
        }

        if (opts.tar || inputFile.pathname.match(/.tar(.\w+$)?$/) || inputFile.pathname.endsWith(".tgz")) {
            stages.push(await createUntarredStream());
        }

        if (opts.from) {
            const mod = await loadPlugin(opts.from,'input');
            const transformer = await mod.transform(Object.assign({path: inputFile},opts.param));
            transformer.on('error', (error: any) => {
                if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    stages[0]?.destroy();
                }
                else {
                    logger.error("input stream processing error: ", error.message);
                    stages[0]?.destroy();
                    process.exitCode = 2;
                }
            });
            transformer.on('finish', () => logger.debug('writeable finished'));
            transformer.on('end', () => logger.debug('readable ended'));
            transformer.on('close', () => logger.debug('stream closed'));
            stages.push(transformer);
        }
        else {
            console.error(`Need --from`);
            process.exit(1);
        }

        if (opts.count || opts.skip) {
            stages.push( 
                createCountableSkippedStream(
                    opts.count,
                    opts.skip
                )
            );
        }

        const verboseStream = createVerboseStream();
        stages.push(verboseStream);

        if (opts.map) {
            const mod = await loadPlugin(opts.map,'transform');
            const transformer : Transform = await mod.transform(opts.param);
            stages.push(transformer);
        }

        let outStream : Writable;

        if (isWritableStream(opts.out)) {
            outStream = opts.out;
        }
        else if (opts.out === '@slow') {
            outStream = new SlowWritable({ delayMs: 100 });
        }
        else if (opts.out === '@errors') {
            outStream = new SlowWritable({ simulateErrorEveryN: 2 });
        }
        else if (opts.out) {
            if (opts.out.startsWith("sftp")) {
                const url = new URL(opts.out);
                
                if (process.env.SFTP_USERNAME) {
                    url.username = process.env.SFTP_USERNAME;
                }

                if (process.env.SFTP_PASSWORD) {
                    url.password = process.env.SFTP_PASSWORD;
                }

                logger.info(`put ${getCleanURL(url)}`);
                outStream = await sftpWriteStream(url, opts);
            }
            else if (opts.out.startsWith("s3")) {
                const url = new URL(opts.out);

                if (process.env.S3_ACCESS_KEY) {
                    url.username = process.env.S3_ACCESS_KEY;
                }

                if (process.env.S3_SECRET_KEY) {
                    url.password = process.env.S3_SECRET_KEY;
                }

                logger.info(`put ${getCleanURL(url)}`);
                outStream = await s3WriteStream(url,{});
            }
            else {
                outStream = fs.createWriteStream(opts.out, { encoding: 'utf-8'});
            }
        }
        else {
            outStream = process.stdout;
        }

        if (opts.to) {
            const mod = await loadPlugin(opts.to,'output');
            stages.push(await mod.transform(opts.param));
            stages.push(outStream);
            try {
                await pipeline(stages);
                result = verboseStream.getCount();
                logger.info("pipeline finished cleanly");
            }
            catch (err : any) {
                if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    logger.info("Stream closed by limiter.");
                } else {
                    logger.error("pipeline error:", err);
                    throw new PipelineError(err.message, 3);
                }
            }
        }
    }
    catch (e) {
        if (e instanceof PipelineError) {
            throw (e);
        }
        else {
            logger.error(`process crashed with: ${e}`);
            throw (e);
        }
    }
    return result;
}

function getCleanURL(url: URL) : URL {
    const tempUrl = new URL(url.href); // Clone to avoid mutating original
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
    // internal state check
    obj.writable !== false
  );
}