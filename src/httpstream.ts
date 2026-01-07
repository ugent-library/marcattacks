import { Readable } from 'stream';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export function httpReadStream(urlString: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(urlString);
            const client = url.protocol === 'http:' ? http : https;

            const req = client.get(url, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error('HTTP ' + res.statusCode));
                    return;
                }

                // Follow redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    httpReadStream(res.headers.location).then(resolve).catch(reject);
                    return;
                }

                resolve(res);
            });

            req.on('error', reject);
        }
        catch (error) {
            reject(error);
        }
    });
}