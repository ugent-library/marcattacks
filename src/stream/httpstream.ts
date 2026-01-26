import { Readable } from 'stream';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import log4js from 'log4js';

const logger = log4js.getLogger();

export function httpReadStream(urlString: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL(urlString);
            const client = url.protocol === 'http:' ? http : https;

            logger.debug(`resolve ${url.href}`);

            const req = client.get(url, res => {
                const statusCode = res.statusCode || 0;

                logger.debug(`statusCode = ${statusCode}`);

                if (statusCode >= 400) {
                    reject(new Error('HTTP ' + res.statusCode));
                    return;
                }

                // Follow redirects (without any sanity checks..i know)
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    logger.info(`Redirect to ${res.headers.location}...`);
                    httpReadStream(res.headers.location).then(resolve).catch(reject);
                    return;
                }

                resolve(res);
            });

            req.on('error', (error) => {
                logger.error("http request error: ", error);
                reject(error);
            });
        }
        catch (error) {
            logger.error("http stream error: ", error);
            reject(error);
        }
    });
}