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
    static pubSafeProps = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
    abstract get allConf(): ConfigData | undefined;
    protected cachedConfig: ConfigData | undefined;

    protected get pubConf(): ConfigData | undefined {
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

    async loadFiles(cFiles: ConfigFiles): Promise<ConfigData | undefined> {
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
                    if (isConfigData(eObj)) this.cachedConfig = eObj;
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

export const configFromFS = async (): Promise<ConfigData | undefined> => {
    const fcu = new FSConfigUtil();

    if (!fcu.allConf) {
        await fcu.load();
    }

    return fcu.allConf;
};

export const config = async (): Promise<ConfigData | undefined> => {
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
