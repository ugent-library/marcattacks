import { Readable } from 'stream';
import * as http from 'http';
import * as https from 'https';
import * as N3 from 'n3';
import { URL } from 'url';
import log4js from 'log4js';

const logger = log4js.getLogger();

const LDP = 'http://www.w3.org/ns/ldp#';
const DCTERMS = 'http://purl.org/dc/terms/';

export function httpReadStream(url: URL): Promise<Readable> {
    return new Promise(async (resolve, reject) => {
        try {
            const client = url.protocol === 'http:' ? http : https;

            logger.debug(`resolve ${url.href}`);

            const req = client.get(url, res => {
                const statusCode = res.statusCode || 0;

                logger.debug(`statusCode = ${statusCode}`);

                if (statusCode >= 400) {
                    logger.error(`http error:`,res.statusMessage);
                    reject(new Error('HTTP ' + res.statusCode));
                    return;
                }

                // Follow redirects (without any sanity checks..i know)
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    logger.info(`Redirect to ${res.headers.location}...`);
                    httpReadStream(new URL(res.headers.location)).then(resolve).catch(reject);
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

export async function httpLatestObject(url: URL): Promise<URL> {
    logger.info(`trying to resolve ${url.href}`);

    if (!url.href.includes("@latest:")) {
        logger.info(`resolved as: ${url.href}`);
        return url;
    }

    const containerUrl = url.href.replace(/@latest:.*$/, "");
    const targetExt = url.href.split("@latest:")[1]?.toLowerCase();

    logger.debug(`containerUrl:`, containerUrl);
    logger.debug(`targetExt`,targetExt);

    try {
        const stream = await httpReadStream(new URL(containerUrl));
        const parser = new N3.Parser({ baseIRI: containerUrl });
        
        let latestUrl: string | null = null;
        let latestDate: Date | null = null;

        const store = new N3.Store();

        return new Promise((resolve, reject) => {
            parser.parse(stream, (error, quad) => {
                if (error) return reject(error);
                if (quad) {
                    store.add(quad);
                } else {
                    const members = store.getObjects(N3.DataFactory.namedNode(containerUrl), N3.DataFactory.namedNode(LDP + 'contains'), null);

                    for (const member of members) {
                        const memberUrl = member.value;
                        
                        if (targetExt && targetExt !== '*' && !memberUrl.toLowerCase().endsWith(targetExt)) {
                            continue;
                        }

                        const modifiedLiteral = store.getObjects(member, N3.DataFactory.namedNode(DCTERMS + 'modified'), null)[0];
                        
                        if (modifiedLiteral) {
                            const modifiedDate = new Date(modifiedLiteral.value);
                            
                            if (!latestDate || modifiedDate > latestDate) {
                                latestDate = modifiedDate;
                                latestUrl = memberUrl;
                            }
                        }
                    }

                    if (!latestUrl) {
                        reject(new Error(`no ${targetExt} members found in ${containerUrl}`));
                    } else {
                        logger.info(`resolved as: ${latestUrl}`);
                        resolve(new URL(latestUrl));
                    }
                }
            });
        });
    } catch (error) {
        logger.error("error finding latest HTTP file");
        throw error;
    }
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
        const stream = await httpReadStream(new URL(containerUrl)); //
        const parser = new N3.Parser({ baseIRI: containerUrl });
        const matchedUrls: URL[] = [];

        return new Promise((resolve, reject) => {
            parser.parse(stream, (error, quad) => {
                if (error) {
                    logger.debug(error);
                    logger.error("RDF parse error");
                    reject(error);
                    return;
                }

                if (quad) {
                    const isLdpContains = quad.predicate.value === `${LDP}contains`;
                    
                    if (isLdpContains && quad.object.termType === 'NamedNode') {
                        const result = new URL(quad.object.value);

                        if (result.href.endsWith(extension) || extension === '*') {
                            matchedUrls.push(result);
                        }
                    }
                } else {
                logger.debug(`found ${matchedUrls.length} members in container`);
                    resolve(matchedUrls);
                }
            });
        });
    } catch (error) {
        logger.debug(error);
        logger.error("failed to glob HTTP container");
        throw error;
    }
}