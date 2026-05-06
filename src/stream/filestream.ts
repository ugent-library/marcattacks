import fs from "fs";
import type { Readable } from "stream";
import log4js from 'log4js';

const logger = log4js.getLogger();

export async function fileReadStream(url: URL) : Promise<Readable> {
    return fs.createReadStream(url);
}

export async function fileLatestFile(url: URL) : Promise<URL> {
    return new Promise<URL>( (resolve) => {
        logger.info(`trying to resolve ${url.href}`);

        if (!url.href.includes("@latest:")) {
            logger.info(`resolved as ${url.href}`);
            resolve(url);
            return;
        }

        const directory = url.pathname.replaceAll(/@latest:.*/g,"");
        const extension = url.pathname.replaceAll(/.*@latest:/g,"");
       
        logger.debug(`directory: ${directory} ; extension: ${extension}`);

        let candidate : string;
        let candidateStats : fs.Stats;

        fs.readdir(directory, (err,files) => {
           if (err) {
                throw new Error("Error finding latest file:", err);
           } 

           for (let i = 0 ; i < files.length ; i++) {
            if (files[i]?.toLowerCase().endsWith(extension)) {
                const testFile = "file://" + directory + files[i];
                const stats = fs.statSync(directory + files[i]);
                if (candidate) {
                    if (stats.mtime > candidateStats.mtime ) {
                        logger.debug(`found a more recent ${testFile} than ${candidate}`);
                        candidate = testFile;
                        candidateStats = stats;
                    }
                    else {
                        logger.debug(`found ${testFile}, but older than ${candidate}`);
                    }
                }
                else {
                    logger.debug(`set candidate to ${testFile}`);
                    candidate = testFile;
                    candidateStats = stats;
                }
            }
           }

           if (!candidate) {
            throw new Error("No latest file found!");
           }
           else {
            logger.info(`resolved as ${candidate}`);
            resolve(new URL(candidate));
           }
        });
    });
}

export async function fileGlobFiles(url: URL): Promise<URL[]> {
    return new Promise<URL[]>((resolve, reject) => {
        logger.info(`trying to glob files for ${url.href}`);

        // Check if the URL follows the @glob: pattern
        if (!url.href.includes("@glob:")) {
            logger.info(`no glob pattern found, returning original URL in array`);
            resolve([url]);
            return;
        }

        // Extract directory path and extension
        const directory = url.pathname.replaceAll(/@glob:.*/g, "");
        const extension = url.pathname.replaceAll(/.*@glob:/g, "");

        logger.debug(`directory:`,directory);
        logger.debug(`extension:`,extension);

        fs.readdir(directory, (err, files) => {
            if (err) {
                // Reject the promise if the directory cannot be read
                return reject(new Error(`Error reading directory for glob: ${err.message}`));
            }

            const targetExt = extension.toLowerCase();
            const matchedUrls: URL[] = [];

            // Filter all files in the directory that match the extension
            for (const file of files) {
                if (file.toLowerCase().endsWith(targetExt) || targetExt === '*') {
                    // Reconstruct the file URL
                    matchedUrls.push(new URL("file://" + directory + file));
                }
            }

            logger.info(`glob resolved ${matchedUrls.length} files`);
            resolve(matchedUrls);
        });
    });
}