#!/usr/bin/env node

import log4js from 'log4js';
import { program } from 'commander';
import path from "node:path";
import dotenv from 'dotenv';
import { attack, PipelineError } from './attacker.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from "node:url";
import { execSync } from 'node:child_process';
import fs from 'fs';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program.version(pkg.version)
    .argument('<file>')
    .option('-c,--config <config>','config .env',path.join(process.cwd(), '.env'))
    .option('-f,--from <from>','input type','xml')
    .option('-t,--to <output>','output type','json')
    .option('-m,--map <map>','data mapper','jsonata')
    .option('--fix <what>','jsonata')
    .option('-p,--param <key=value>','repeated params',collect,{})
    .option('-o,--out <file>','output file')
    .option('--z','uncompress input')
    .option('--tar','untar input')
    .option('--count <num>', 'output only <num> records')
    .option('--skip <num>', 'skip first <num> records')
    .option('--workers <num>', 'run the map on <num> worker threads; default "auto" = CPU cores - 1 (leaves a core for parsing/I/O). Use 1 to disable. Auto only threads heavy maps (jsonata); cheap maps like fix stay single-threaded unless you pass an explicit number', 'auto')
    .option('--key <keyfile>', 'private key file')
    .option('--key-env <env>','private key environment variable')
    .option('--log <format>','logging format')
    .option('--log-every <num>','logging info for every <num> lines',
        (value) => parseInt(value,10), 1000
    )
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

installReaderDisconnectGuard();

main();

// When the reader on the other end of our stdout pipe goes away — `| less`/`| more`
// then `q`, `| head`, a closed network socket — Node surfaces EPIPE on stdout.
// React the instant that happens, directly on the stream, rather than waiting for
// the pipeline rejection: under backpressure (a pager holding the pipe while we
// wait for `drain`) that rejection can be delayed or, through the worker pool,
// never arrive at all — which is the hang.
function installReaderDisconnectGuard() {
    process.stdout.on('error', (err: any) => {
        if (err && (err.code === 'EPIPE' || /\bEPIPE\b/.test(String(err.message)))) {
            restoreTerminalAndDie();
        }
    });
}

// Exit cleanly after the output reader disconnected, leaving the terminal usable.
//
// Two things conspire to wedge the terminal (no echo, needs `reset`) when piped to
// a pager that you quit mid-stream:
//  1. The pager puts the tty in raw mode; we may notice the closed pipe before it
//     has fully restored.
//  2. Node ignores SIGPIPE, so (unlike `head`/`yes`) we linger, and a *normal* Node
//     exit then runs libuv's exit-time TTY reset which re-applies the raw termios
//     libuv had captured — re-wedging the tty even if we'd fixed it.
//
// So we force the controlling terminal back to a sane mode with `stty sane`, then
// terminate with a SIGNAL: SIGKILL skips libuv's TTY reset, so our sane state is the
// last word. (`stty sane` + a normal exit does NOT work — the reset clobbers it.)
// If there is no controlling terminal (piped/cron) `stty` fails harmlessly.
//
// NOTE: this fixes the direct/global-install case (`marcattacks … | less`). It can
// NOT fully fix `npx marcattacks … | less`: the `npx` Node parent exits *after* us
// and runs its own libuv TTY reset, which we have no way to suppress from a child.
function restoreTerminalAndDie(): never {
    try {
        execSync('stty sane < /dev/tty 2> /dev/null', { stdio: 'ignore', timeout: 2000 });
    } catch {
        // no controlling tty, or stty unavailable — nothing to restore
    }
    process.kill(process.pid, 'SIGKILL');
    // unreachable; satisfies the `never` return type
    throw new Error('unreachable');
}

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
            default: { appenders: ["err"], level: "error" , enableCallStack: true }
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
            default: { appenders: ["err"], level: "error" , enableCallStack: true }
        }
    });
}

async function main() : Promise<void> {
    try {
        logger.info(`${pkg.name} version ${pkg.version}`);

        const url = program.args[0];

        if (! url) {
            console.error(`need an input file`);
            process.exit(2);
        }

        let inputFile : URL;

        if (fs.existsSync(url)) {
            const filePath = path.resolve(process.cwd(), url);
            inputFile = pathToFileURL(filePath);
        } else {
            inputFile = new URL(url);
        }

        const result = await attack(inputFile,opts);
        logger.info(`total: ${result}`);

        const usage = process.resourceUsage();
        logger.info(`peak RSS: ${usage.maxRSS / 1024} MB`);
    }
    catch (e) {
        if (e instanceof PipelineError && e.readerDisconnected) {
            // Fallback path: the reader-closed-pipe surfaced through the pipeline
            // rejection rather than the direct stdout 'error' guard. Restore the
            // terminal and die the same way. (See restoreTerminalAndDie.)
            restoreTerminalAndDie();
        }
        logger.error(e);
        if (e instanceof PipelineError) {
            logger.error("pipeline error");
            process.exitCode = e.statusCode;
            process.exit();
        }
        else {
            logger.error("process stopped prematurely");   
            process.exitCode = 8;
            process.exit();
        }
    }
}

function collect(value:string, previous: any) {
    const keyval = value.split("=",2);
    if (keyval.length == 2 && keyval[0]) {
        previous[keyval[0]] = keyval[1];
        return previous;
    }
    else {
        return previous;
    }
}