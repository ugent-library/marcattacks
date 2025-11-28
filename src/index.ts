#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import * as xml2rec from './xml2rec.js';
import * as rec2json from './rec2json.js';
import * as rec2alephseq from './rec2alephseq.js';
import * as rec2prolog from './rec2prolog.js';
import * as rec2xml from './rec2xml.js';
import * as rec2rdf from './rec2rdf.js';
import { sftpReadStream , sftpLatestFile , type SftpConfig } from './sftpstream.js';
import rdfTransform from './transform/rdf.js';
import { Readable } from 'stream';
import fs from 'fs';

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
    if (! program.args[0]) {
        console.error(`need an input file`);
        process.exit(2);
    }

    let inputFile = new URL(program.args[0]);

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
   
    if (opts.from === 'xml') {
        objectStream = xml2rec.stream2readable(readableStream);
    }
    else {
        throw new Error(`${opts.from} not supported`);
    }

    if (opts.to === 'json') {
        rec2json.readable2writable(objectStream,process.stdout);
    }
    else if (opts.to == 'alephseq') {
        rec2alephseq.readable2writable(objectStream,process.stdout);
    }
    else if (opts.to == 'prolog') {
        rec2prolog.readable2writable(objectStream,process.stdout);
    }
    else if (opts.to == 'rdf') {
        rec2rdf.readable2writable(objectStream.pipe(rdfTransform({})),process.stdout);
    }
    else if (opts.to == 'xml') {
        rec2xml.readable2writable(objectStream,process.stdout);
    }
    else {
        logger.error(`unknown output type ${opts.to}`);
        process.exit(1);
    }
}