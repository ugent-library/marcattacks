import { Client } from "ssh2";
import { Readable } from "stream";

export interface SftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: Buffer | string;
}

export async function sftpReadStream(config: SftpConfig, remotePath: string): Promise<Readable> {
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