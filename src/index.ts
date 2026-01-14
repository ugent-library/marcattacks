#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import path from "node:path";
import dotenv from 'dotenv';
import { attack } from './attacker.js';

program.version('0.1.0')
    .argument('<file>')
    .option('-c,--config <config>','config .env',path.join(process.cwd(), '.env'))
    .option('-f,--from <from>','input type','xml')
    .option('-t,--to <output>','output type','json')
    .option('-m,--map <map>','data mapper','jsonata')
    .option('--fix <what>','jsonata')
    .option('-o,--out <file>','output file')
    .option('--z','uncompress input')
    .option('--tar','untar input')
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

        await attack(url,opts);
    }
    catch (e) {
        logger.error(`process crashed with: ${e}`);
        process.exitCode = 8;
    }
}