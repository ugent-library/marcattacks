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

        fs.readdir(directory, (err,files) => {
           if (err) {
            throw new Error("Error finding latest file:", err);
           } 

           for (let i = 0 ; i < files.length ; i++) {
            if (files[i]?.toLowerCase().endsWith(extension)) {
                logger.info(`resolved as file://${directory}${files[i]}`);
                resolve(new URL("file://" + directory + files[i]));
                return;
            }
           }

           throw new Error("No latest file found!");
        });
    });
}