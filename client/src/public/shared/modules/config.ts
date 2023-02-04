import { fetchLogger } from '#@shared/modules/logger.js';
import type { Request, Response, NextFunction } from 'express';
import { inBrowser, prettyFsNotFound } from '#@shared/modules/utils.js';

const log = fetchLogger();

type NodeEnv = 'development' | 'production' | null;
const NODE_ENV: NodeEnv = inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

export interface ConfigData {
    readonly appName: string;
    readonly appVersion?: string;
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}

const isConfigData = <C extends ConfigData>(obj: any): obj is C =>
    obj && obj instanceof Object && Object.keys(obj).every(prop => /^[a-z]+[a-zA-Z0-9]*$/.test(prop));

const isConfigDataPopulated = <C extends ConfigData>(obj: any): obj is C =>
    isConfigData(obj) && Boolean(obj['appName']);

interface ConfigParser {
    parse(src: string): unknown;
}

interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}

abstract class ConfigBase<C extends ConfigData> {
    abstract get conf(): C | null;
    protected configCache: C | null;

    constructor() {
        this.configCache = null;
    }
}

export class FSConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    readonly nodeEnv: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';

    static async asyncNew<C extends ConfigData>(): Promise<FSConfigUtil<C>> {
        const fsc = new FSConfigUtil<C>();
        if (!fsc.conf) {
            await fsc.load();
        }
        return fsc;
    }

    get conf(): C | null {
        return this.configCache;
    }

    load(): Promise<C | undefined> {
        return this.loadFiles({
            development: ['./conf/dev_conf.json', JSON],
            production: ['./conf/prod_conf.json', JSON],
            common: ['./conf/common_conf.json', JSON]
        });
    }

    async loadFiles(cFiles: ConfigFiles): Promise<C | undefined> {
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

                if (!isConfigData<C>(eObj)) {
                    this.configCache = null;
                    log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                    throw new Error(`malformed config property in ${path.join(process.cwd(), nodeEnvConfPath)}`);
                }

                if (commonConfPath) {
                    cObj = cFiles['common']?.[1].parse(readFileSync(commonConfPath, 'utf8'));

                    if (isConfigData<C>(cObj)) {
                        this.configCache = { ...eObj, ...cObj };
                    } else {
                        console.warn(
                            `loadFiles(): contents of ${path.join(
                                process.cwd(),
                                commonConfPath
                            )} ignored due to impropper format`
                        );
                        this.configCache = eObj;
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

        if (!(this.configCache instanceof Object && 'appName' in this.configCache)) {
            throw new Error(
                `No config or config missing required 'appName' property. config: ${JSON.stringify(this.configCache)}`
            );
        }

        return this.configCache;
    }
}

export class DOMConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    protected pubSafe: readonly string[];
    constructor(conf?: C, pubSafe?: readonly string[]) {
        super();

        this.pubSafe = pubSafe ?? ([] as const);

        if (!inBrowser()) {
            if (!conf) {
                throw new Error(`please provide conf param to constructor`);
            } else {
                this.configCache = conf;
            }
        }
    }

    public get conf() {
        if (!this.configCache) {
            this.configCache = this.extract();
        }

        return this.configCache;
    }

    protected get pubConf(): C | undefined {
        const self = this;

        const handler = {
            get(target: object, prop: PropertyKey, receiver: any) {
                if (typeof prop === 'string')
                    if (self.pubSafe.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    } else {
                        return undefined;
                    }
            },
            ownKeys(target: object) {
                return Object.keys(target).filter(prop => self.pubSafe.includes(prop));
            },
            set() {
                throw new Error('pubConf is immutable.');
            }
        };
        if (this.configCache) {
            return new Proxy(this.configCache, handler) as C;
        } else {
            return undefined;
        }
    }

    protected extract<C extends ConfigData>(): C | null {
        const conf = document.getElementById('configData')?.dataset;

        if (isConfigDataPopulated<C>(conf)) {
            return conf;
        }

        return null;
    }

    public populateDOM(req: Request, res: Response, next: NextFunction) {
        if (!this.configCache) throw new Error('config cache empty - pass in conf to constructor`');

        res.locals['configData'] = this.pubConf;
        res.locals['NODE_ENV'] = NODE_ENV;
        res.locals['camelCaseToDashDelim'] = (prop: string) => prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

        next();
    }
}
