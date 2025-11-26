#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import { processStream } from './xml2rec.js';
import { rec2json } from './rec2json.js';
import { rec2alephseq } from './rec2alephseq.js';
import { rec2prolog } from './rec2prolog.js';
import { rec2xml } from './rec2xml.js';
import { rec2rdf } from './rec2rdf.js';
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
    const readableStream = fs.createReadStream(inputFile);

    const events = processStream(readableStream,logger);

    if (opts.to === 'json') {
        rec2json(events);
    }
    else if (opts.to == 'alephseq') {
        rec2alephseq(events);
    }
    else if (opts.to == 'prolog') {
        rec2prolog(events);
    }
    else if (opts.to == 'rdf') {
        rec2rdf(events);
    }
    else if (opts.to == 'xml') {
        rec2xml(events);
    }
    else {
        logger.error(`unknown output type ${opts.to}`);
        process.exit(1);
    }
}