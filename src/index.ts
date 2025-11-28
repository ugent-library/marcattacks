#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import { processStream } from './xml2rec.js';
import { rec2json } from './rec2json.js';
import { rec2alephseq } from './rec2alephseq.js';
import { rec2prolog } from './rec2prolog.js';
import { rec2xml } from './rec2xml.js';
import { rec2rdf } from './rec2rdf.js';
import { sftpReadStream , sftpLatestFile , type SftpConfig } from './sftpstream.js';
import rdfTransform from './transform/rdf.js';
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
    .option('-t,--to <output>','output type','json')
    .option('--host <host>', 'sftp host')
    .option('--port <port>', 'sftp port',"22")
    .option('-u,--username <user>', 'sftp user')
    .option('-p,--password <password>', 'sftp password')
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
    let inputFile = program.args[0];

    if (! inputFile) {
        console.error(`need an input file`);
        process.exit(2);
    }

    logger.info(`using: ${inputFile}`);

    let readableStream;

    if (opts.host) {
        let privateKey : string | undefined = undefined;

        if (opts.key) {
            privateKey = fs.readFileSync(opts.key,{ encoding: 'utf-8'});
        }

        let config: SftpConfig = {
            host: opts.host,
            port: Number(opts.port),
            username: opts.username
        };

        if (opts.password) { config.password = opts.password }
        if (privateKey) { config.privateKey = privateKey}

        if (inputFile.match(/\/@latest:\w+$/)) {
            const remoteDir = inputFile.replace(/\/@latest.*/,"");
            const extension = inputFile.replace(/.*\/@latest:/,"");
            inputFile = await sftpLatestFile(config,remoteDir,extension);
        }

        logger.info(`connecting to ${opts.host} as ${opts.username}`);
        readableStream = await sftpReadStream(config, inputFile)
    }
    else {
        readableStream = fs.createReadStream(inputFile);
    }

    const objectStream = processStream(readableStream,logger);

    if (opts.to === 'json') {
        rec2json(objectStream);
    }
    else if (opts.to == 'alephseq') {
        rec2alephseq(objectStream);
    }
    else if (opts.to == 'prolog') {
        rec2prolog(objectStream);
    }
    else if (opts.to == 'rdf') {
        rec2rdf(objectStream.pipe(rdfTransform({})));
    }
    else if (opts.to == 'xml') {
        rec2xml(objectStream);
    }
    else {
        logger.error(`unknown output type ${opts.to}`);
        process.exit(1);
    }
}