import log4js from 'log4js';
import { program } from 'commander';
import { processStream } from './xml2json.js';
import { json2out } from './json2out.js';
import fs from 'fs';

program.version('0.1.0')
    .argument('<file>')
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
    json2out(events);
}