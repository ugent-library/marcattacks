#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import { loadPlugin } from './plugin-loader.js';
import { sftpReadStream , sftpLatestFile , type SftpConfig } from './sftpstream.js';
import * as rdfTransform from './transform/rdf.js';
import { Readable } from 'stream';
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from 'fs';
import type { Transform, Writable } from 'node:stream';

log4js.configure({
  appenders: {
    err: { type: "stderr" }
  },
  categories: {
    default: { appenders: ["err"], level: "info" }
  }
});

program.version('0.1.0')
    .argument('<file>')
    .option('-f,--from <from>','input type','xml')
    .option('-t,--to <output>','output type','json')
    .option('-m,--map <map>','data mapper')
    .option('-o,--out <file>','output file')
    .option('--key <keyfile>', 'private key file')
    .option('--info','output debugging messages')
    .option('--debug','output more debugging messages')
    .option('--trace','output much more debugging messages');

program.parse(process.argv);

const opts   = program.opts();
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

main();

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

    if (inputFile.protocol === 'sftp:') {
        let privateKey : string | undefined = undefined;

        if (opts.key) {
            privateKey = fs.readFileSync(opts.key,{ encoding: 'utf-8'});
        }

        let config: SftpConfig = {
            host: inputFile.hostname,
            port: Number(inputFile.port),
            username: inputFile.username
        };

        if (inputFile.password) { config.password = inputFile.password }
        if (privateKey) { config.privateKey = privateKey}

        let remotePath;

        if (inputFile.pathname.match(/\/@latest:\w+$/)) {
            const remoteDir = inputFile.pathname.replace(/\/@latest.*/,"");
            const extension = inputFile.pathname.replace(/.*\/@latest:/,"");
            remotePath = await sftpLatestFile(config,remoteDir,extension);
        }
        else {
            remotePath = inputFile.pathname;
        }

        logger.info(`get ${opts.username}@${opts.host}:${remotePath}`);
        readableStream = await sftpReadStream(config, remotePath)
    }
    else {
        readableStream = fs.createReadStream(inputFile);
    }

    let objectStream : Readable;
   
    if (opts.from) {
        const mod = await loadPlugin(opts.from,'input');
        objectStream = mod.stream2readable(readableStream);
    }
    else {
        console.error(`Need --from`);
        process.exit(1);
    }

    let resultStream = objectStream;

    if (opts.map) {
        const mod = await loadPlugin(opts.map,'transform');
        const transformer : Transform = mod.transform({});
        resultStream = objectStream.pipe(transformer);
    }

    let outStream : Writable;

    if (opts.out) {
        outStream = fs.createWriteStream(opts.out, { encoding: 'utf-8'});
    }
    else {
        outStream = process.stdout;
    }

    if (opts.to) {
        const mod = await loadPlugin(opts.to,'output');
        mod.readable2writable(resultStream, outStream);
    }
}