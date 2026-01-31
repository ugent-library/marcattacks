import { Readable } from 'stream';
import * as http from 'http';
import * as https from 'https';
import * as N3 from 'n3';
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

export async function httpGlobFiles(url: URL): Promise<URL[]> {
    logger.info(`Globbing HTTP RDF at ${url.href}`);

    if (!url.href.includes("@glob:")) {
        return [url];
    }

    const containerUrl = url.href.replace(/@glob:.*$/, "");
    const extension = url.href.replace(/.*@glob:/g,"");
    
    logger.debug(`containerUrl:`, containerUrl);
    logger.debug(`extension:`,extension);

    try {
        const stream = await httpReadStream(containerUrl); //
        const parser = new N3.Parser({ baseIRI: containerUrl });
        const matchedUrls: URL[] = [];

        return new Promise((resolve, reject) => {
            parser.parse(stream, (error, quad) => {
                if (error) {
                    logger.error("RDF Parse Error:", error);
                    reject(error);
                    return;
                }

                if (quad) {
                    const isLdpContains = quad.predicate.value === 'http://www.w3.org/ns/ldp#contains';
                    
                    if (isLdpContains && quad.object.termType === 'NamedNode') {
                        const result = new URL(quad.object.value);

                        if (result.href.endsWith(extension) || extension === '*') {
                            matchedUrls.push(result);
                        }
                    }
                } else {
                    logger.info(`Found ${matchedUrls.length} members in container`);
                    resolve(matchedUrls);
                }
            });
        });
    } catch (error) {
        logger.error("Failed to glob HTTP container:", error);
        throw error;
    }
}