import { LogLevel, levelsArr } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
import type { Request, Response, NextFunction } from 'express';

//write a config class that's more like the LoggerUtil class. It will have the following methods/properties:
// all() return all config params
// public() return public config params
// private() return private config params
// DOMInjectConf(req, res, next) express middleware --puts pub config into dom
// DOMExtractConf() private method to parse HTML for config, used internally to get config data to browser clients
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
    parse(src: string): unknown;
}

interface ConfigFiles {
    common: [string, ConfigParser] | null;
    development: [string, ConfigParser] | null;
    production: [string, ConfigParser] | null;
}

class ConfigUtil {
    public allConf: ConfigData = {};
    static readonly permitPublic = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
    private readonly defaults: Required<ConfigData> = {
        app_name: null,
        app_version: null,
        log_level: null,
        loc_level: null,
        node_env: null
    };

    //sync constructor
    constructor(private baseConfig: ConfigData = {}) {
        if (inBrowser()) {
            this.baseConfig.app_name = 'fluidity web app';
            //prase DOM
            //populate this.baseConfig
        }

        this.allConf = Object.freeze({ ...this.defaults, ...this.baseConfig });
    }

    //async contructor
    private static async new(nodeEnv: NodeEnv, cFiles: ConfigFiles): Promise<ConfigUtil> {
        //this *should never happen:
        if (inBrowser()) return new ConfigUtil();

        //node logic:
        const nodeEnvConfPath = cFiles[nodeEnv]?.[0];
        const commonConfPath = cFiles['common']?.[0];

        const { existsSync: exists, readFileSync: read } = await import('fs');

        if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
            const eObj = cFiles[nodeEnv]?.[1].parse(read(nodeEnvConfPath, 'utf8'));

            if (eObj) {
                if (commonConfPath && exists(commonConfPath)) {
                    const cObj = cFiles['common']?.[1].parse(read(commonConfPath, 'utf8'));

                    if (cObj) {
                        return new ConfigUtil({ ...eObj, ...cObj });
                    }
                } else {
                    return new ConfigUtil(eObj);
                }
            }
        }

        return new ConfigUtil();
    }

    public static async load(): Promise<ConfigUtil> {
        const YAML = await import('yaml');

        return ConfigUtil.new(process.env['NODE_ENV'] === 'development' ? 'development' : 'production', {
            development: ['./conf/dev_conf.yaml', YAML],
            production: ['./conf/prod_conf.yaml', YAML],
            common: ['./conf/common_conf.yaml', YAML]
        });
    }

    private get pubConf(): ConfigData {
        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (ConfigUtil.permitPublic.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            }
        };
        return new Proxy(this.allConf, handler);
    }

    // public DOMinjectConf(req: Request, res: Response, next: NextFunction): void {}
    // use this: https://github.com/richardschneider/express-mung
}

export const asyncConfig = (): Promise<ConfigData> => {
    return new Promise((resolve, reject) => {
        if (inBrowser()) {
            return resolve(new ConfigUtil().allConf);
        } else {
            ConfigUtil.load()
                .then(c => {
                    return resolve(c.allConf);
                })
                .catch(err => {
                    reject(err);
                });
        }
    });
};

export const syncConfig = (): ConfigData => {
    if (inBrowser()) {
        return new ConfigUtil().allConf;
    } else {
        throw new Error('syncConfig only available to browser');
    }
};
