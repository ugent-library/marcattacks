import { Client } from "ssh2";
import { Readable , Writable } from "stream";
import fs from 'fs';
import log4js from 'log4js';
import { getCleanURL, getStrippedURL } from "../util/stream_helpers.js";

const logger = log4js.getLogger();

export interface SftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
}

export async function sftpReadStream(url: URL, opts: any): Promise<Readable> {
    const config = makeSftpConfig(url,opts);

    logger.debug(`sftp config:`, redactConfig(config));
    
    const remotePath = url.pathname;

    logger.info(`remotePath: ${remotePath}`);
    
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let stream: Readable | undefined;

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream = sftp.createReadStream(remotePath);

                // Close SSH connection when stream ends or errors
                stream.on("close", () => conn.end());
                stream.on("error", (err: any) => {
                    conn.end();
                    reject(err);
                });

                resolve(stream);
            });
        });

        // Before handoff, reject the promise; after handoff, the promise is
        // already settled so forward the connection error to the live stream
        // (otherwise a dropped connection mid-transfer hangs the consumer).
        conn.on("error", (err) => {
            if (stream) { stream.destroy(err); }
            else { reject(err); }
        });
        conn.connect(config);
    });
}

export async function sftpWriteStream(url: URL, opts: any): Promise<Writable> {
    const config = makeSftpConfig(url,opts);

    logger.debug(`sftp config:`, redactConfig(config));

    let remotePath = url.pathname;

    return new Promise((resolve, reject) => {
        const conn = new Client();
        let stream: Writable | undefined;

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream = sftp.createWriteStream(remotePath, { encoding: "utf-8" });

                // Close SSH connection when stream ends or errors
                stream.on("close", () => conn.end());
                stream.on("error", (err: any) => {
                    conn.end();
                    reject(err);
                });

                resolve(stream);
            });
        });

        // Before handoff, reject the promise; after handoff, the promise is
        // already settled so forward the connection error to the live stream
        // (otherwise a dropped connection mid-transfer hangs the consumer).
        conn.on("error", (err) => {
            if (stream) { stream.destroy(err); }
            else { reject(err); }
        });
        conn.connect(config);
    });
}

export async function sftpLatestFile(url: URL, opts: any): Promise<URL> {
    const config = makeSftpConfig(url,opts);

    // getCleanURL: the URL carries the SFTP user:password (from the CLI URL or
    // the SFTP_PASSWORD env fallback), so never log url.href raw.
    logger.info(`trying to resolve ${getCleanURL(url).href}`);

    logger.debug(`sftp config:`, redactConfig(config));

    return new Promise((resolve, reject) => {
        if (! url.pathname.match(/\/@latest:\S+$/)) {
            logger.info(`resolved as: ${getCleanURL(url).href}`);
            resolve(url);
            return;
        }

        const remoteDir = url.pathname.replace(/\/@latest.*/,"");
        const extension = url.pathname.replace(/.*\/@latest:/,"");

        const conn = new Client();

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                sftp.readdir(remoteDir, (err, list) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    if (!list || list.length === 0) {
                        conn.end();
                        return reject(new Error("No files found in directory"));
                    }

                    // Filter only .xml files
                    const myFiles = list.filter(f => f.filename.toLowerCase().endsWith(extension));

                    if (myFiles.length === 0) {
                        conn.end();
                        return reject(new Error(`No ${extension} files found in directory`));
                    }

                    const latest = myFiles.reduce((prev, curr) => 
                        (prev.attrs.mtime > curr.attrs.mtime) ? prev : curr
                    );

                    const latestPath = `${remoteDir}/${latest.filename}`;
                    conn.end();

                    const url_parts : string[] = [];

                    url_parts.push(url.protocol);
                    url_parts.push('//');
                    if (url.username) {
                        url_parts.push(url.username);
                        if (url.password) {
                            url_parts.push(':')
                            url_parts.push(url.password);
                        }
                        url_parts.push('@');
                    } 
                    url_parts.push(url.hostname);
                    if (!(url.port === "80" || url.port === "443")) {
                        url_parts.push(':');
                        url_parts.push(url.port);
                    }
                    url_parts.push(latestPath);

                    // url_parts embeds user:password — redact before logging.
                    const resolved = new URL(url_parts.join(""));
                    logger.info(`resolved as: ${getCleanURL(resolved).href}`);
                    resolve(resolved);
                });
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
}

export async function sftpGlobFiles(url: URL, opts: any): Promise<URL[]> {
    const config = makeSftpConfig(url, opts);

    logger.info(`trying to glob files for ${getCleanURL(url).href}`);

    logger.debug(`sftp config:`, redactConfig(config));

    return new Promise((resolve, reject) => {
        // Check if the URL follows the @glob: pattern
        if (!url.pathname.match(/\/@glob:\S+$/)) {
            logger.info(`no glob pattern found, returning original URL in array`);
            // getStrippedURL: these URLs are printed to stdout by globtrotr, so
            // they must not carry the SFTP user:password (mirrors the S3 path).
            resolve([getStrippedURL(url)]);
            return;
        }

        const remoteDir = url.pathname.replace(/\/@glob.*/, "");
        const extension = url.pathname.replace(/.*\/@glob:/, "");

        logger.debug(`remoteDir:`,remoteDir);
        logger.debug(`extension:`,extension);

        const conn = new Client();

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                sftp.readdir(remoteDir.length ? remoteDir : "/", (err, list) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    if (!list || list.length === 0) {
                        conn.end();
                        return resolve([]); // Return empty array if no files exist
                    }

                    // Filter files by the extension provided after @glob:
                    const matchedFiles = list.filter(f => 
                        f.filename.toLowerCase().endsWith(extension.toLowerCase()) ||
                        extension === '*'
                    );

                    const results = matchedFiles.map(file => {
                        const filePath = `${remoteDir}/${file.filename}`;
                        
                        // Reconstruct the URL for each matched file
                        const url_parts: string[] = [];
                        url_parts.push(url.protocol);
                        url_parts.push('//');
                        
                        if (url.username) {
                            url_parts.push(url.username);
                            if (url.password) {
                                url_parts.push(':');
                                url_parts.push(url.password);
                            }
                            url_parts.push('@');
                        }
                        
                        url_parts.push(url.hostname);
                        
                        if (url.port && !["80", "443"].includes(url.port)) {
                            url_parts.push(':');
                            url_parts.push(url.port);
                        }
                        
                        url_parts.push(filePath);
                        // Strip credentials: the result is printed to stdout by
                        // globtrotr (mirrors the S3 glob path).
                        return getStrippedURL(new URL(url_parts.join("")));
                    });

                    conn.end();
                    logger.info(`glob resolved ${results.length} files`);
                    resolve(results);
                });
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
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
        port: inputFile.port ? Number(inputFile.port) : 22,
        // URL.username/password are percent-encoded; decode so credentials with
        // reserved characters (@ : # %) work after being %-escaped in the URL.
        username: decodeURIComponent(inputFile.username)
    };

    if (inputFile.password) { config.password = decodeURIComponent(inputFile.password) }
    if (privateKey) { config.privateKey = privateKey}

    return config;
}

const REDACTED_KEYS = ['password', 'privateKey', 'username'];

function redactConfig(obj: any): any {
    const redactedObj = { ...obj };
    for (const key in redactedObj) {
        if (REDACTED_KEYS.includes(key)) {
            redactedObj[key] = '********'; // Mask the value
        } 
        else {
            redactedObj[key] = redactedObj[key];
        }
    }
    return redactedObj;
}