import { Client } from "ssh2";
import { Readable , Writable } from "stream";
import fs from 'fs';
import log4js from 'log4js';

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

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                const stream = sftp.createReadStream(remotePath);

                // Close SSH connection when stream ends or errors
                stream.on("close", () => conn.end());
                stream.on("error", (err: any) => {
                    conn.end();
                    reject(err);
                });

                resolve(stream);
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
}

export async function sftpWriteStream(url: URL, opts: any): Promise<Writable> {
    const config = makeSftpConfig(url,opts);

    logger.debug(`sftp config:`, redactConfig(config));

    let remotePath = url.pathname;

    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on("ready", () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                const stream = sftp.createWriteStream(remotePath, { encoding: "utf-8" });

                // Close SSH connection when stream ends or errors
                stream.on("close", () => conn.end());
                stream.on("error", (err: any) => {
                    conn.end();
                    reject(err);
                });

                resolve(stream);
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
}

export async function sftpLatestFile(url: URL, opts: any): Promise<URL> {
    const config = makeSftpConfig(url,opts);

    logger.info(`trying to resolve ${url.href}`);

    logger.debug(`sftp config:`, redactConfig(config));

    return new Promise((resolve, reject) => {
        if (! url.pathname.match(/\/@latest:\S+$/)) {
            logger.info(`resolved as: ${url.href}`);
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

                    logger.info(`resolved as: ${url_parts.join("")}`);
                    resolve(new URL(url_parts.join("")));
                });
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
}

export async function sftpGlobFiles(url: URL, opts: any): Promise<URL[]> {
    const config = makeSftpConfig(url, opts);

    logger.info(`trying to glob files for ${url.href}`);
    
    logger.debug(`sftp config:`, redactConfig(config));

    return new Promise((resolve, reject) => {
        // Check if the URL follows the @glob: pattern
        if (!url.pathname.match(/\/@glob:\S+$/)) {
            logger.info(`no glob pattern found, returning original URL in array`);
            resolve([url]);
            return;
        }

        const remoteDir = url.pathname.replace(/\/@glob.*/, "");
        const extension = url.pathname.replace(/.*\/@glob:/, "");

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
                        return new URL(url_parts.join(""));
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
        port: Number(inputFile.port) ?? 22,
        username: inputFile.username
    };

    if (inputFile.password) { config.password = inputFile.password }
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