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
import { finished } from 'node:stream/promises';

program.version('0.1.0')
    .argument('<file>')
    .option('-c,--config <config>','config .env',path.join(process.cwd(), '.env'))
    .option('-f,--from <from>','input type','xml')
    .option('-t,--to <output>','output type','json')
    .option('-m,--map <map>','data mapper','jsonata')
    .option('--fix <what>','jsonata')
    .option('-o,--out <file>','output file')
    .option('--key <keyfile>', 'private key file')
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

    logger.info(`using: ${inputFile}`);

    let readableStream;

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
    else {
        readableStream = fs.createReadStream(inputFile);
    }

    let objectStream : Readable;
   
    if (opts.from) {
        const mod = await loadPlugin(opts.from,'input');
        objectStream = await mod.stream2readable(readableStream, {
            path: inputFile
        });
    }
    else {
        console.error(`Need --from`);
        process.exit(1);
    }

    let resultStream = objectStream;

    if (opts.map) {
        const mod = await loadPlugin(opts.map,'transform');
        const transformer : Transform = await mod.transform(opts.fix);
        resultStream = objectStream.pipe(transformer);
    }

    let outStream : Writable;

    if (opts.out === '@slow') {
        outStream = new SlowWritable({ delayMs: 100 });
    }
    else if (opts.out) {
        if (opts.out.startsWith("sftp")) {
            const url = new URL(opts.out);
            const config = makeSftpConfig(url,opts);
            logger.info(`put ${url}`);
            outStream = await sftpWriteStream(url.href, config);
        }
        else if (opts.out.startsWith("s3")) {
            const url = new URL(opts.out);
            logger.info(`put ${url}`);
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
        mod.readable2writable(resultStream, outStream);
        await finished(outStream);
    }
}

function makeSftpConfig(inputFile: URL, opts: any) : SftpConfig {
    let privateKey : string | undefined = undefined;

    if (opts.key) {
        privateKey = fs.readFileSync(opts.key,{ encoding: 'utf-8'});
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