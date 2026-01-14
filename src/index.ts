#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import { loadPlugin } from './plugin-loader.js';
import { sftpReadStream , sftpWriteStream , sftpLatestFile , type SftpConfig } from './sftpstream.js';
import { httpReadStream } from './httpstream.js';
import { Readable } from 'stream';
import { pathToFileURL } from "node:url";
import type { Transform, Writable } from 'node:stream';
import { SlowWritable } from './slow-writable.js';
import path from "node:path";
import fs from 'fs';
import { s3ReaderStream, s3WriterStream } from './s3stream.js';
import dotenv from 'dotenv';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'zlib';
import { createCountableSkippedStream, createVerboseStream } from './util/stream_helpers.js';

program.version('0.1.0')
    .argument('<file>')
    .option('-c,--config <config>','config .env',path.join(process.cwd(), '.env'))
    .option('-f,--from <from>','input type','xml')
    .option('-t,--to <output>','output type','json')
    .option('-m,--map <map>','data mapper','jsonata')
    .option('--fix <what>','jsonata')
    .option('-o,--out <file>','output file')
    .option('-z','compressed')
    .option('--count <num>', 'output only <num> records')
    .option('--skip <num>', 'skip first <num> records')
    .option('--key <keyfile>', 'private key file')
    .option('--key-env <env>','private key environment variable')
    .option('--log <format>','logging format')
    .option('--info','output debugging messages')
    .option('--debug','output more debugging messages')
    .option('--trace','output much more debugging messages');

program.parse(process.argv);

const opts   = program.opts();

if (opts.log) {
    let output = 'stderr';
    let type = 0;

    if (opts.log.indexOf('stdout') >= 0) {
        output = 'stdout';
    }
    if (opts.log.indexOf('json') >= 0) {
        type = 1;
    }

    if (type) {
        configureJSONLogger(output);
    }
    else {
        configureDefaultLogger(output);
    }
}
else {
    configureDefaultLogger('stderr');
}

const logger = log4js.getLogger();

if (opts.info) {
    logger.level = "info";
}

if (opts.debug) {
    logger.level = "debug";
}

if (opts.trace) {
    logger.level = "trace";
}

if (opts.config) {
    dotenv.config({ path: opts.config , quiet: true });
}

main();

function configureDefaultLogger(output: string) {
    log4js.configure({
        appenders: {
            err: { 
                type: output ,
                layout: {
                    type: "pattern",
                    pattern: "%[%d %p %f{1} %m%]"
                }
            }
        },
        categories: {
            default: { appenders: ["err"], level: "off" , enableCallStack: true }
        }
    });
}

function configureJSONLogger(output: string) {
    log4js.addLayout('json-pattern', (config) => {
        return (logEvent) => {
            return JSON.stringify({
            timestamp: logEvent.startTime,  // Similar to %d
            level: logEvent.level.levelStr, // Similar to %p
            category: logEvent.categoryName,// Similar to %c
            message: logEvent.data.join(' '), // Similar to %m
            context: logEvent.context,      // Similar to %X (tokens)
            pid: logEvent.pid               // Similar to %z
            });
        };
    });

    log4js.configure({
        appenders: {
            err: { 
                type: output ,
                layout: {
                    type: "json-pattern"
                }
            }
        },
        categories: {
            default: { appenders: ["err"], level: "off" , enableCallStack: true }
        }
    });
}

async function main() : Promise<void> {
    try {
        const url = program.args[0];

        if (! url) {
            console.error(`need an input file`);
            process.exit(2);
        }

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
            readableStream = await s3ReaderStream(inputFile,{});
        }
        else if (inputFile.protocol === 'sftp:') {
            const config = makeSftpConfig(inputFile,opts);
            let remotePath;

            if (inputFile.pathname.match(/\/@latest:\w+$/)) {
                const remoteDir = inputFile.pathname.replace(/\/@latest.*/,"");
                const extension = inputFile.pathname.replace(/.*\/@latest:/,"");
                remotePath = await sftpLatestFile(config,remoteDir,extension);
            }
            else {
                remotePath = inputFile.pathname;
            }

            readableStream = await sftpReadStream(remotePath, config);
        }
        else if (inputFile.protocol === 'stdin:') {
            readableStream = process.stdin;
        }
        else {
            readableStream = fs.createReadStream(inputFile);
        }

        const stages: (Readable | Transform | Writable)[] = [readableStream];

        if (opts.z) {
            stages.push(createGunzip()); 
        }

        if (opts.from) {
            const mod = await loadPlugin(opts.from,'input');
            const transformer = await mod.transform({path: inputFile});
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

        stages.push(createVerboseStream());

        if (opts.map) {
            const mod = await loadPlugin(opts.map,'transform');
            const transformer : Transform = await mod.transform(opts.fix);
            stages.push(transformer);
        }

        let outStream : Writable;

        if (opts.out === '@slow') {
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

                const config = makeSftpConfig(url,opts);
                logger.info(`put ${getCleanURL(url)}`);
                outStream = await sftpWriteStream(url.href, config);
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
                outStream = await s3WriterStream(url,{});
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
            stages.push(await mod.transform());
            stages.push(outStream);
            try {
                await pipeline(stages);
                logger.info("pipeline finished cleanly");
            }
            catch (err : any) {
                if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    logger.info("Stream closed by limiter.");
                } else {
                    logger.error("pipeline error:", err);
                    process.exitCode = 3;
                }
            }
        }
    }
    catch (e) {
        logger.error(`process crashed with: ${e}`);
        process.exitCode = 8;
    }
}

function getCleanURL(url: URL) : URL {
    const tempUrl = new URL(url.href); // Clone to avoid mutating original
    tempUrl.username = '***';
    tempUrl.password = '***';
    return tempUrl;
}

function makeSftpConfig(inputFile: URL, opts: any) : SftpConfig {
    let privateKey : string | undefined = undefined;

    if (opts.key) {
        privateKey = fs.readFileSync(opts.key,{ encoding: 'utf-8'});
    }
    else if (opts.keyEnv) {
        privateKey = process.env[opts.keyEnv];
    }

    let config: SftpConfig = {
        host: inputFile.hostname,
        port: Number(inputFile.port) ?? 22,
        username: inputFile.username
    };

    if (inputFile.password) { config.password = inputFile.password }
    if (privateKey) { config.privateKey = privateKey}

    return config;
}