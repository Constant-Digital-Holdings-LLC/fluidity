import type { Request, Response, NextFunction } from 'express';
import { fetchLogger, LogLevel } from '#@shared/modules/logger.js';
import { inBrowser, prettyFsNotFound } from '#@shared/modules/utils.js';

const log = fetchLogger();
type NodeEnv = 'development' | 'production';

function isMyConfigData(obj: any): obj is MyConfigData {
    return obj && obj instanceof Object && Object.keys(obj).every(prop => /^[a-z]+[a-z0-9 _]*$/.test(prop));
}

export interface ConfigData {
    readonly app_name: string;
    readonly app_version?: string;
    readonly log_level?: LogLevel;
    readonly loc_level?: LogLevel;
    readonly node_env?: NodeEnv;
    readonly [index: string]: unknown;
}

import { MyConfigData, pubSafeProps } from '#@shared/my_config.js';

interface ConfigParser {
    parse(src: string): unknown;
}

interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}

abstract class ConfigBase {
    abstract get allConf(): MyConfigData | undefined;
    public cachedConfig: MyConfigData | undefined;

    protected get pubConf(): MyConfigData | undefined {
        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (pubSafeProps.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            },
            ownKeys(target: object) {
                // intercept property list
                return Object.keys(target).filter(prop => pubSafeProps.includes(prop));
            }
        };
        if (this.cachedConfig) {
            return new Proxy(this.cachedConfig, handler) as MyConfigData;
        } else {
            return undefined;
        }
    }
}

class FSConfigUtil extends ConfigBase {
    private nodeEnv: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

    get allConf(): MyConfigData | undefined {
        return this.cachedConfig;
    }

    async load(): Promise<MyConfigData | undefined> {
        const YAML = await import('yaml');

        const cFiles: ConfigFiles = {
            development: ['./conf/dev_conf.yaml', YAML],
            production: ['./conf/prod_conf.yaml', YAML],
            common: ['./conf/common_conf.yaml', YAML]
        };

        return this.loadFiles(cFiles);
    }

    async loadFiles(cFiles: ConfigFiles): Promise<MyConfigData | undefined> {
        if (inBrowser()) {
            throw new Error('loadFiles(): not available to browser');
        }

        const nodeEnvConfPath = cFiles[this.nodeEnv]?.[0];
        const commonConfPath = cFiles['common']?.[0];
        const { readFileSync } = await import('fs');

        const path = await import('node:path');

        let eObj: unknown;
        let cObj: unknown;

        try {
            if (nodeEnvConfPath) {
                eObj = cFiles[this.nodeEnv]?.[1].parse(readFileSync(nodeEnvConfPath, 'utf8'));

                if (!isMyConfigData(eObj)) {
                    this.cachedConfig = undefined;
                    log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                    throw new Error(`loadFiles(): impropper config file format for this node-env`);
                }

                if (commonConfPath) {
                    cObj = cFiles['common']?.[1].parse(readFileSync(commonConfPath, 'utf8'));

                    if (isMyConfigData(cObj)) {
                        this.cachedConfig = { ...eObj, ...cObj };
                    } else {
                        log.warn(
                            `loadFiles(): contents of ${path.join(
                                process.cwd(),
                                commonConfPath
                            )} ignored due to impropper format`
                        );
                        this.cachedConfig = eObj;
                    }
                } else {
                    log.debug('loadFiles(): common config not provided');
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                const formattedError = await prettyFsNotFound(err);

                log.error(formattedError || err);

                log.error(err.stack);
            } else {
                log.error(err);
            }
        }

        return this.cachedConfig;
    }
}

class DOMConfigUtil extends ConfigBase {
    constructor(conf?: MyConfigData) {
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

    private extract(): MyConfigData {
        //   parse DOM

        return { app_name: 'Fluidity', log_level: 'debug', foo: 'bar' };
    }

    addLocals(req: Request, res: Response, next: NextFunction): void {
        if (!this.cachedConfig) throw new Error('addLocals() middleware requires config data for req.locals');

        res.locals['configData'] = this.pubConf;
        next();
    }
}

export const configFromDOM = (): MyConfigData => {
    return new DOMConfigUtil().allConf;
};

export const configFromFS = async (): Promise<MyConfigData | undefined> => {
    const fsConf = new FSConfigUtil();

    if (inBrowser()) throw new Error('browser can not access filesystem, use configFromDom()');

    if (!fsConf.allConf) {
        await fsConf.load();
    }

    return fsConf.allConf;
};

export const config = async (): Promise<MyConfigData | undefined> => {
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
