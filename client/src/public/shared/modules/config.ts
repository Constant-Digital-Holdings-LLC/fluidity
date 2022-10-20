import { LogLevel, levelsArr, loggerUtility } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
import type { Request, Response, NextFunction } from 'express';

//write a config class that's more like the LoggerUtil class. It will have the following methods/properties:
// all() return all config params
// public() return public config params
// private() return private config params
// DOMInjectConf(req, res, next) express middleware --puts pub config into dom
// DOMExtractConf() private method to parse HTML for config, used internally
// publicConfigProps: string[] - will contain strings like 'log_level', 'loc_level', 'app_name', 'app_version'
//
// class will have two contructors - the normal syncronous one used by the browser AND an async one used by node
// the async contructor will take an optional (not needed for browser) node_env ('production' or 'development') param and an optional ConfFiles object param (browser will get config from DOM)
// the sync constructor will take the same function signature
// see factor method example here - https://medium.com/@guillaume.viguierjust/dealing-with-asynchronous-constructors-in-typescript-c13c14c80954
//
// Note- There should be config object called 'defaults' everything else will get 'spread' ontop of. The defaults object witll have log_level, loc_level, etc already set. The interface should
// idicate that these values are strings|null that way we're forced to do some type narrowing in code (because we can't guaruntee that their not being overwritten to ). We also need to make each
// config property optional in the interface
//
// files object will look like:
//
// ConfFiles: {
//     common?: [string, ConfigParser];
//     development?: [string, ConfigParser];
//     production?: [string, ConfigParser];
// }
// the string part of the tuple is a path to the file
// The ConfFiles keys will have to be a union between the NODE_ENV type and 'common'
//
// The parser looks simply like:
// interface ConfigParser {
//     parse(): Config
// }

// New Code:

type NodeEnv = 'development' | 'production';

interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
}

interface ConfigParser {
    parse(): ConfigData;
}

interface ConfigFiles {
    common?: [string, ConfigParser];
    development?: [string, ConfigParser];
    production?: [string, ConfigParser];
}

interface Constructors {
    nodeEnv?: NodeEnv;
    cFiles?: ConfigFiles;
}

class ConfigUtil {
    private readonly permitPublic = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
    private readonly defaults: Required<ConfigData> = {
        app_name: null,
        app_version: null,
        log_level: null,
        loc_level: null,
        node_env: null
    };

    //sync constructor used by either node or the browser
    constructor({ nodeEnv, cFiles }: Constructors = {}) {}

    //async contructor used by node
    public static async new({ nodeEnv, cFiles }: Required<Constructors>): Promise<ConfigUtil> {
        return new ConfigUtil();
    }

    // public get allConf(): ConfigData {}

    // public get pubConf(): ConfigData {}

    // public get privConf(): ConfigData {}

    // public DOMinjectConf(req: Request, res: Response, next: NextFunction): void {}
}

//
//  OLD/PRIOR CODE BELOW:
//
//
// interface Config {
//     log_level?: LogLevel;
//     loc_level?: LogLevel;
// }

// interface RootConfig {
//     public?: Config;
//     private?: Config;
// }

// let commonConf: RootConfig | undefined;
// let devConf: RootConfig | undefined;
// let prodConf: RootConfig | undefined;

// const getMergedConf = (): Promise<RootConfig> => {
//     return new Promise((resolve, reject) => {
//         if (!inBrowser()) {
//             import('fs').then(fs => {
//                 const { readFileSync: read } = fs;
//                 import('yaml').then(YAML => {
//                     const { parse } = YAML;

//                     try {
//                         commonConf ??= parse(read('./conf/common_conf.yaml', 'utf8'));
//                         devConf ??= parse(read('./conf/dev_conf.yaml', 'utf8'));
//                         prodConf ??= parse(read('./conf/prod_conf.yaml', 'utf8'));
//                     } catch (err) {
//                         console.error(`could not read and parse config file(s)`);
//                         return reject(err);
//                     }

//                     if (commonConf && devConf && prodConf) {
//                         if (process.env['NODE_ENV'] === 'development') {
//                             resolve({
//                                 public: { ...devConf?.public, ...commonConf?.public },
//                                 private: { ...devConf?.private, ...commonConf?.private }
//                             });
//                         } else {
//                             resolve({
//                                 public: { ...prodConf?.public, ...commonConf?.public },
//                                 private: { ...prodConf?.private, ...commonConf?.private }
//                             });
//                         }
//                     } else {
//                         return reject('could not parse one or more config files');
//                     }
//                 });
//             });
//         } else {
//             return reject('getMergedConf() called in the browser, codepath requires fs!');
//         }
//     });
// };

// export const config: Promise<Config> = new Promise((resolve, reject) => {
//     if (inBrowser()) {
//         //get conf from DOM
//         resolve({ log_level: 'debug' });
//     } else {
//         getMergedConf()
//             .then(c => {
//                 resolve({ ...c.public, ...c.private });
//             })
//             .catch(err => {
//                 return reject(err);
//             });
//     }
// });
