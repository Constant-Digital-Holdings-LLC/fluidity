import type { Request, Response, NextFunction } from 'express';
import { LogLevel } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';

type NodeEnv = 'development' | 'production';

function isConfigData(obj: any): obj is ConfigData {
    return obj && obj instanceof Object;
}

export interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
    [index: string]: unknown;
}

interface ConfigParser {
    parse(src: string): unknown;
}

interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}

abstract class ConfigBase {
    static pubSafeProps = ['app_name', 'log_level', 'app_version', 'loc_level', 'node_env'];
    abstract get allConf(): ConfigData | undefined;
    public cachedConfig: ConfigData | undefined;

    protected get pubConf(): ConfigData | undefined {
        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (ConfigBase.pubSafeProps.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            },
            ownKeys(target: object) {
                // to intercept property list
                return Object.keys(target).filter(prop => ConfigBase.pubSafeProps.includes(prop));
            }
        };
        if (this.cachedConfig) {
            return new Proxy(this.cachedConfig, handler) as ConfigData;
        } else {
            return undefined;
        }
    }
}

class FSConfigUtil extends ConfigBase {
    private nodeEnv: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

    get allConf(): ConfigData | undefined {
        return this.cachedConfig;
    }

    async load(): Promise<ConfigData | undefined> {
        const YAML = await import('yaml');

        const cFiles: ConfigFiles = {
            development: ['./conf/dev_conf.yaml', YAML],
            production: ['./conf/prod_conf.yaml', YAML],
            common: ['./conf/common_conf.yaml', YAML]
        };

        return this.loadFiles(cFiles);
    }

    foo() {
        /^[A-Za-z0-9 _]*$/.test('words');
    }

    async loadFiles(cFiles: ConfigFiles): Promise<ConfigData | undefined> {
        const nodeEnvConfPath = cFiles[this.nodeEnv]?.[0];
        const commonConfPath = cFiles['common']?.[0];
        const { existsSync: exists, readFileSync: read } = await import('fs');

        //work in progress:
        const isValid = (obj: object): boolean => {
            return Object.keys(obj).some(prop => /^[a-z]+[a-z0-9 _]*$/.test(prop));
        };

        if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
            const eObj = cFiles[this.nodeEnv]?.[1].parse(read(nodeEnvConfPath, 'utf8'));
            //make sure all object properties are lowercase and dont dashes
            if (eObj && isValid(eObj)) {
                if (commonConfPath && exists(commonConfPath)) {
                    const cObj = cFiles['common']?.[1].parse(read(commonConfPath, 'utf8'));
                    //make sure all object properties are lowercase and dont contain dashes
                    if (cObj && isValid(cObj)) {
                        this.cachedConfig = { ...eObj, ...cObj };
                    }
                } else {
                    if (isConfigData(eObj)) this.cachedConfig = eObj;
                }
            }
        }
        return this.cachedConfig;
    }
}

class DOMConfigUtil extends ConfigBase {
    constructor(conf?: ConfigData) {
        super();

        conf && (this.cachedConfig = conf);
    }

    get allConf() {
        if (!this.cachedConfig) {
            this.cachedConfig = this.extract();
        }
        console.warn(`pub test: ${JSON.stringify(this.pubConf)}`);
        return this.cachedConfig;
    }

    private extract(): ConfigData {
        //   parse DOM

        return { log_level: 'debug', foo: 'bar' };
    }

    addLocals(req: Request, res: Response, next: NextFunction): void {
        if (!this.cachedConfig) throw new Error('addLocals() requires ConfigData for req flow insertion');
        res.locals['configData'] = this.pubConf;
        next();
    }
}

export const configFromDOM = (): ConfigData => {
    return new DOMConfigUtil().allConf;
};

export const configFromFS = async (): Promise<ConfigData | undefined> => {
    const fsConf = new FSConfigUtil();

    if (inBrowser()) throw new Error('browser can not access filesystem, use configFromDom()');

    if (!fsConf.allConf) {
        await fsConf.load();
    }

    return fsConf.allConf;
};

export const config = async (): Promise<ConfigData | undefined> => {
    if (inBrowser()) {
        return configFromDOM();
    } else {
        return configFromFS();
    }
};

export const configMiddleware = async (): Promise<(req: Request, res: Response, next: NextFunction) => void> => {
    const dcu = new DOMConfigUtil(await new FSConfigUtil().load());

    return dcu.addLocals.bind(dcu);
};
