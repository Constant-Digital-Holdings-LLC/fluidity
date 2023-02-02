import type { Request, Response, NextFunction } from 'express';
import { LogLevel } from '#@shared/modules/logger.js';
import { inBrowser, prettyFsNotFound, fetchLogger } from '#@shared/modules/utils.js';

const log = fetchLogger();

type NodeEnv = 'development' | 'production' | null;
const NODE_ENV: NodeEnv = inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

const isMyConfigData = (obj: any): obj is MyConfigData =>
    obj && obj instanceof Object && Object.keys(obj).every(prop => /^[a-z]+[a-zA-Z0-9]*$/.test(prop));

const isMyConfigDataPopulated = (obj: any): obj is MyConfigData => isMyConfigData(obj) && Boolean(obj['appName']);

export interface ConfigData {
    readonly appName: string;
    readonly appVersion?: string;
    readonly logLevel?: LogLevel;
    readonly locLevel?: LogLevel;
    readonly logFormat?: 'JSON' | 'unstructured';
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}

import { MyConfigData, pubSafeProps } from '#@shared/modules/my_config.js';

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
    protected cachedConfig: MyConfigData | undefined;

    protected get pubConf(): MyConfigData | undefined {
        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (pubSafeProps.includes(prop as any)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            },
            ownKeys(target: object) {
                return Object.keys(target).filter(prop => pubSafeProps.includes(prop as any));
            },
            set() {
                throw new Error('pubConf is immutable.');
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
    readonly nodeEnv: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
    get allConf(): MyConfigData | undefined {
        return this.cachedConfig;
    }

    load(): Promise<MyConfigData | undefined> {
        // const YAML = await import('yaml');
        // moving from YAML to JSON, loadFiles() is fine with either

        return this.loadFiles({
            development: ['./conf/dev_conf.json', JSON],
            production: ['./conf/prod_conf.json', JSON],
            common: ['./conf/common_conf.json', JSON]
        });
    }

    async loadFiles(cFiles: ConfigFiles): Promise<MyConfigData | undefined> {
        if (!NODE_ENV) {
            throw new Error('loadFiles() not applicable outside of node');
        }

        const nodeEnvConfPath = cFiles[NODE_ENV]?.[0];
        const commonConfPath = cFiles['common']?.[0];
        const { readFileSync } = await import('fs');

        const path = await import('node:path');

        let eObj: unknown;
        let cObj: unknown;

        try {
            if (nodeEnvConfPath) {
                eObj = cFiles[NODE_ENV]?.[1].parse(readFileSync(nodeEnvConfPath, 'utf8'));

                if (!isMyConfigData(eObj)) {
                    this.cachedConfig = undefined;
                    log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                    throw new Error(`malformed config property in ${path.join(process.cwd(), nodeEnvConfPath)}`);
                }

                if (commonConfPath) {
                    cObj = cFiles['common']?.[1].parse(readFileSync(commonConfPath, 'utf8'));

                    if (isMyConfigData(cObj)) {
                        this.cachedConfig = { ...eObj, ...cObj };
                    } else {
                        console.warn(
                            `loadFiles(): contents of ${path.join(
                                process.cwd(),
                                commonConfPath
                            )} ignored due to impropper format`
                        );
                        this.cachedConfig = eObj;
                    }
                } else {
                    console.debug('loadFiles(): common config not provided');
                }
            }
        } catch (err) {
            if (err instanceof Error) {
                const formattedError = await prettyFsNotFound(err);

                log.error(formattedError || err.message);
            } else {
                log.error(err);
            }
        }

        if (
            typeof this.cachedConfig !== 'object' ||
            (typeof this.cachedConfig === 'object' && !('appName' in this.cachedConfig))
        ) {
            throw new Error(
                `No config or config missing required 'appName' property. config: ${JSON.stringify(this.cachedConfig)}`
            );
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

        return this.cachedConfig;
    }

    private extract(): MyConfigData | undefined {
        const conf = document.getElementById('configData')?.dataset;

        if (isMyConfigDataPopulated(conf)) {
            return conf;
        }

        return undefined;
    }

    addLocals(req: Request, res: Response, next: NextFunction): void {
        if (!this.cachedConfig) throw new Error('addLocals() middleware requires config data for req.locals');

        res.locals['configData'] = this.pubConf;
        res.locals['NODE_ENV'] = NODE_ENV;
        res.locals['camelCaseToDashDelim'] = (prop: string) => prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

        next();
    }
}

export const configFromDOM = (): MyConfigData | undefined => {
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
