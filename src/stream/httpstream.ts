import { Readable } from 'stream';
import * as http from 'http';
import * as https from 'https';
import * as N3 from 'n3';
import { URL } from 'url';
import log4js from 'log4js';
import { ExitCode } from '../exit-codes.js';

// A remote/protocol failure: tag it so the CLI exits EX_PROTOCOL (76).
function protocolError(message: string): Error {
    const e: any = new Error(message);
    e.exitCode = ExitCode.PROTOCOL;
    return e;
}

const logger = log4js.getLogger();

const LDP = 'http://www.w3.org/ns/ldp#';
const DCTERMS = 'http://purl.org/dc/terms/';

// Shared keep-alive agents at module scope so sockets are actually reused
// across calls and redirect hops (a per-call agent defeats keep-alive).
const httpAgent = new http.Agent({ keepAlive: true, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 60000 });

const MAX_REDIRECTS = 10;

export function httpReadStream(url: URL, redirectsLeft: number = MAX_REDIRECTS): Promise<Readable> {
    return new Promise((resolve, reject) => {
        try {
            const client = url.protocol === 'http:' ? http : https;
            const agent = url.protocol  === 'http:' ? httpAgent : httpsAgent;

            logger.debug(`resolve ${url.href}`);

            const req = client.get(url, { agent }, res => {
                // This callback runs after the synchronous try/catch below has
                // already returned, so anything that can throw here (notably
                // `new URL(location, url)` on a malformed `Location` header)
                // must be guarded explicitly or it becomes an uncaughtException.
                try {
                    const statusCode = res.statusCode || 0;

                    logger.debug(`statusCode = ${statusCode}`);

                    if (statusCode >= 400) {
                        logger.error(`http error:`,res.statusMessage);
                        res.resume(); // drain the body so the socket can be reused/freed
                        reject(protocolError('HTTP ' + res.statusCode));
                        return;
                    }

                    // Follow redirects. Resolve the Location relative to the current
                    // URL (it may be relative) and cap the hops to avoid loops.
                    if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                        res.resume(); // drain the redirect body
                        if (redirectsLeft <= 0) {
                            reject(protocolError(`too many redirects (> ${MAX_REDIRECTS})`));
                            return;
                        }
                        logger.info(`Redirect to ${res.headers.location}...`);
                        httpReadStream(new URL(res.headers.location, url), redirectsLeft - 1)
                            .then(resolve).catch(reject);
                        return;
                    }

                    resolve(res);
                }
                catch (error) {
                    // e.g. a malformed/invalid Location header on a redirect.
                    logger.error("http response handling error: ", error);
                    res.resume(); // drain so the socket can be freed
                    reject(error);
                }
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
            stream.on('error' , (err) => {
                logger.error('stream failed during RDF parsing');
                reject(err);
            });
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
            stream.on('error' , (err) => {
                logger.error('stream failed during RDF parsing');
                reject(err);
            });
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