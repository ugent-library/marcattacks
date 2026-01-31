#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import path from "node:path";
import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { sftpGlobFiles } from './stream/sftpstream.js';
import { s3GlobFiles } from './stream/s3stream.js';
import { fileGlobFiles } from './stream/filestream.js';
import { httpGlobFiles } from './stream/httpstream.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program.version(pkg.version)
    .argument('<file>')
    .option('-c,--config <config>','config .env',path.join(process.cwd(), '.env'))
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
                    pattern: "%[%d %p %f{2} %m%]"
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

        let globs : URL[] = [];
        
        if (url?.startsWith("sftp")) {
            globs = await sftpGlobFiles(new URL(url),program.opts());
        }
        else if (url?.startsWith("s3")) {
            const s3url = new URL(url);

            if (process.env.S3_ACCESS_KEY) {
                s3url.username = process.env.S3_ACCESS_KEY;
            }

            if (process.env.S3_SECRET_KEY) {
                s3url.password = process.env.S3_SECRET_KEY;
            }

            globs = await s3GlobFiles(s3url,program.opts());
        }
        else if (url?.startsWith("file")) {
            globs = await fileGlobFiles(new URL(url));
        }
        else if (url?.startsWith("http")) {
            globs = await httpGlobFiles(new URL(url));
        }
        else {
            console.error(`${url} not supported`);
        }

        globs.forEach( g => {
            console.log(g.href);
        });
    }
    catch (e) {
        logger.error("process crashed:", e);
        process.exitCode = 4;
    }
}