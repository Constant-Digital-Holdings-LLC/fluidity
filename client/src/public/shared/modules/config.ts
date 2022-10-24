import type { Request, Response, NextFunction } from 'express';
import { LogLevel, levelsArr } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';

type NodeEnv = 'development' | 'production';

interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
    [index: string]: unknown;
}

interface ConfigParser {
    parse(src: string): ConfigData | undefined;
}

interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}

abstract class ConfigBase {
    static pubSafeProps = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
    abstract get allConf(): ConfigData;
    protected cachedConfig: ConfigData = {};

    protected get pubConf(): ConfigData {
        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (ConfigBase.pubSafeProps.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            }
        };
        return new Proxy(this.cachedConfig, handler) as ConfigData;
    }
}

class FSConfigUtil extends ConfigBase {
    private nodeEnv: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

    get allConf(): ConfigData {
        if (!this.cachedConfig) {
            throw new Error('call load() method first');
        } else {
            return this.cachedConfig;
        }
    }

    async load(): Promise<ConfigData> {
        const YAML = await import('yaml');

        const cFiles: ConfigFiles = {
            development: ['./conf/dev_conf.yaml', YAML],
            production: ['./conf/prod_conf.yaml', YAML],
            common: ['./conf/common_conf.yaml', YAML]
        };

        YAML.parse();

        const nodeEnvConfPath = cFiles[this.nodeEnv]?.[0];
        const commonConfPath = cFiles['common']?.[0];
        const { existsSync: exists, readFileSync: read } = await import('fs');
        if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
            const eObj = cFiles[this.nodeEnv]?.[1].parse(read(nodeEnvConfPath, 'utf8'));
            if (eObj) {
                if (commonConfPath && exists(commonConfPath)) {
                    const cObj = cFiles['common']?.[1].parse(read(commonConfPath, 'utf8'));
                    if (cObj) {
                        this.cachedConfig = { ...eObj, ...cObj };
                    }
                } else {
                    this.cachedConfig = eObj;
                }
            }
        }
        return this.cachedConfig;
    }
}

class DOMConfigUtil extends ConfigBase {
    constructor(private _conf?: ConfigData) {
        super();

        _conf && (this.cachedConfig = _conf);
    }

    get allConf() {
        if (!this.cachedConfig) {
            this.cachedConfig = this.extract();
        }
        return this.cachedConfig;
    }

    private extract(): ConfigData {
        //   parse DOM, populate this.allConf
        return { log_level: 'debug' };
    }

    inject(req: Request, res: Response, next: NextFunction) {
        // put all this.pubConf in the DOM
        // use this: https://github.com/richardschneider/express-mung
    }
}

export const configFromDOM = (): ConfigData => {
    return new DOMConfigUtil().allConf;
};

export const configFromFS = async (): Promise<ConfigData> => {
    const fcu = new FSConfigUtil();
    if (!fcu.allConf) {
        await fcu.load();
    }
    return fcu.allConf;
};

export const config = async (): Promise<ConfigData> => {
    if (inBrowser()) {
        return configFromDOM();
    } else {
        return configFromFS();
    }
};

export const configMiddleware = async (): Promise<(req: Request, res: Response, next: NextFunction) => void> => {
    const config = await new FSConfigUtil().load();
    const domConfigUtil = new DOMConfigUtil(config);
    return domConfigUtil.inject;
};

//OLD CODE:

// class ConfigUtil {
//     public allConf: ConfigData = {};
//     static readonly permitPublic = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
//     private readonly defaults: Required<ConfigData> = {
//         app_name: null,
//         app_version: null,
//         log_level: null,
//         loc_level: null,
//         node_env: null
//     };

//     //sync constructor
//     constructor(private baseConfig: ConfigData = {}) {
//         if (inBrowser()) {
//             this.baseConfig.app_name = 'fluidity web app';
//             //prase DOM
//             //populate this.baseConfig
//         }

//         this.allConf = Object.freeze({ ...this.defaults, ...this.baseConfig });
//     }

//     //async contructor
//     private static async new(nodeEnv: NodeEnv, cFiles: ConfigFiles): Promise<ConfigUtil> {
//         //this *should never happen:
//         if (inBrowser()) return new ConfigUtil();

//         //node logic:
//         const nodeEnvConfPath = cFiles[nodeEnv]?.[0];
//         const commonConfPath = cFiles['common']?.[0];

//         const { existsSync: exists, readFileSync: read } = await import('fs');

//         if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
//             const eObj = cFiles[nodeEnv]?.[1].parse(read(nodeEnvConfPath, 'utf8'));

//             if (eObj) {
//                 if (commonConfPath && exists(commonConfPath)) {
//                     const cObj = cFiles['common']?.[1].parse(read(commonConfPath, 'utf8'));

//                     if (cObj) {
//                         return new ConfigUtil({ ...eObj, ...cObj });
//                     }
//                 } else {
//                     return new ConfigUtil(eObj);
//                 }
//             }
//         }

//         return new ConfigUtil();
//     }

//     public static async load(): Promise<ConfigUtil> {
//         const YAML = await import('yaml');

//         return ConfigUtil.new(process.env['NODE_ENV'] === 'development' ? 'development' : 'production', {
//             development: ['./conf/dev_conf.yaml', YAML],
//             production: ['./conf/prod_conf.yaml', YAML],
//             common: ['./conf/common_conf.yaml', YAML]
//         });
//     }

//     private get pubConf(): ConfigData {
//         const handler = {
//             get(target: object, prop: PropertyKey, receiver: any) {
//                 if (typeof prop === 'string')
//                     if (ConfigUtil.permitPublic.includes(prop)) {
//                         return Reflect.get(target, prop, receiver);
//                     } else {
//                         return undefined;
//                     }
//             }
//         };
//         return new Proxy(this.allConf, handler);
//     }

//     // public DOMinjectConf(req: Request, res: Response, next: NextFunction): void {}
//     // use this: https://github.com/richardschneider/express-mung
// }

// export const asyncConfig = (): Promise<ConfigData> => {
//     return new Promise((resolve, reject) => {
//         if (inBrowser()) {
//             return resolve(new ConfigUtil().allConf);
//         } else {
//             ConfigUtil.load()
//                 .then(c => {
//                     return resolve(c.allConf);
//                 })
//                 .catch(err => {
//                     reject(err);
//                 });
//         }
//     });
// };

// export const syncConfig = (): ConfigData => {
//     if (inBrowser()) {
//         return new ConfigUtil().allConf;
//     } else {
//         throw new Error('syncConfig only available to browser');
//     }
// };
