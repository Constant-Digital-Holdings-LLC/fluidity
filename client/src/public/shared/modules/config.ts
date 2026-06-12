import { fetchLogger } from '#@shared/modules/logger.js';
import type { Request, Response, NextFunction } from 'express';
import { inBrowser, nodeEnv, prettyFsNotFound } from '#@shared/modules/utils.js';
import { NodeEnv, isObject } from '#@shared/types.js';

const log = fetchLogger();

const NODE_ENV: NodeEnv = nodeEnv();

export interface ConfigData {
    readonly appName: string;
    readonly appVersion: string;
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}

export const isConfigData = <C extends ConfigData>(item: unknown): item is C =>
    isObject(item) && Object.keys(item).every(prop => /^[a-z]+[a-zA-Z0-9]*$/.test(prop));

export const isConfigDataPopulated = <C extends ConfigData>(obj: unknown): obj is C =>
    isConfigData(obj) && Boolean(obj['appName']);

interface ConfigFiles {
    readonly common: string | null;
    readonly development: string | null;
    readonly production: string | null;
}

abstract class ConfigBase<C extends ConfigData> {
    abstract get conf(): C | null;
    protected configCache: C | null;

    constructor() {
        this.configCache = null;
    }
}

export class FSConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    readonly nodeEnv: NodeEnv = nodeEnv();

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
            development: './conf/dev_conf.json',
            production: './conf/prod_conf.json',
            common: './conf/common_conf.json'
        });
    }

    async loadFiles(cFiles: ConfigFiles): Promise<C | undefined> {
        if (!NODE_ENV) {
            throw new Error('loadFiles() not applicable outside of node');
        }

        const nodeEnvConfPath = cFiles[NODE_ENV];
        const commonConfPath = cFiles['common'];
        const { readFileSync } = await import('fs');

        const path = await import('node:path');

        let eObj: unknown;
        let cObj: unknown;

        try {
            if (nodeEnvConfPath) {
                eObj = JSON.parse(readFileSync(nodeEnvConfPath, 'utf8'));

                if (!isConfigData<C>(eObj)) {
                    this.configCache = null;
                    log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                    throw new Error(`malformed config property in ${path.join(process.cwd(), nodeEnvConfPath)}`);
                }

                if (commonConfPath) {
                    cObj = JSON.parse(readFileSync(commonConfPath, 'utf8'));

                    if (isConfigData<C>(cObj)) {
                        //common supplies the defaults; the env-specific file
                        //wins on any key collision
                        this.configCache = { ...cObj, ...eObj };
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

        if (!(this.configCache instanceof Object)) {
            throw new Error(
                `No config loaded: expected ${nodeEnvConfPath ?? '(no path)'} relative to ${process.cwd()} ` +
                    `(NODE_ENV: ${NODE_ENV}). Starter configs live in ./conf/conf-examples/.`
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

    protected get pubConf(): Partial<C> | undefined {
        if (!this.configCache) {
            return undefined;
        }
        const conf = this.configCache;

        //a fresh pick of the public-safe keys - nothing else reaches the DOM
        return Object.fromEntries(
            this.pubSafe.filter(key => key in conf).map(key => [key, conf[key as keyof C]])
        ) as Partial<C>;
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

        res.locals['configData'] = { ...this.pubConf, nodeEnv: NODE_ENV };
        res.locals['camelCaseToDashDelim'] = (prop: string) => prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

        next();
    }
}
