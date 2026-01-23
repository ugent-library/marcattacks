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

    logger.debug(`sftp config:`, config);
    
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

    logger.debug(`sftp config:`, config);

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

    logger.debug(`sftp config:`, config);

    return new Promise((resolve, reject) => {
        if (! url.pathname.match(/\/@latest:\w+$/)) {
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

                    logger.trace(`resolved as: ${url_parts.join("")}`);
                    resolve(new URL(url_parts.join("")));
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