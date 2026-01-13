import { Client } from "ssh2";
import { Readable , Writable } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export interface SftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
}

export async function sftpReadStream(remotePath: string, config: SftpConfig): Promise<Readable> {
    logger.debug(`sftp config:`, config);

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

export async function sftpWriteStream(remotePath: string, config: SftpConfig): Promise<Writable> {
    logger.debug(`sftp config:`, config);

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

export async function sftpLatestFile(config: SftpConfig, remoteDir: string, extension: string): Promise<string> {
    logger.debug(`sftp config:`, config);

    return new Promise((resolve, reject) => {
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
                    resolve(latestPath);
                });
            });
        });

        conn.on("error", (err) => reject(err));
        conn.connect(config);
    });
}