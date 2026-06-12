var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { fetchLogger } from '#@shared/modules/logger.js';
import { inBrowser, nodeEnv, prettyFsNotFound } from '#@shared/modules/utils.js';
import { isObject } from '#@shared/types.js';
const log = fetchLogger();
const NODE_ENV = nodeEnv();
export const isConfigData = (item) => isObject(item) && Object.keys(item).every(prop => /^[a-z]+[a-zA-Z0-9]*$/.test(prop));
export const isConfigDataPopulated = (obj) => isConfigData(obj) && Boolean(obj['appName']);
class ConfigBase {
    constructor() {
        this.configCache = null;
    }
}
export class FSConfigUtil extends ConfigBase {
    constructor() {
        super(...arguments);
        this.nodeEnv = nodeEnv();
    }
    static asyncNew() {
        return __awaiter(this, void 0, void 0, function* () {
            const fsc = new FSConfigUtil();
            if (!fsc.conf) {
                yield fsc.load();
            }
            return fsc;
        });
    }
    get conf() {
        return this.configCache;
    }
    load() {
        return this.loadFiles({
            development: './conf/dev_conf.json',
            production: './conf/prod_conf.json',
            common: './conf/common_conf.json'
        });
    }
    loadFiles(cFiles) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!NODE_ENV) {
                throw new Error('loadFiles() not applicable outside of node');
            }
            const nodeEnvConfPath = cFiles[NODE_ENV];
            const commonConfPath = cFiles['common'];
            const { readFileSync } = yield import('fs');
            const path = yield import('node:path');
            let eObj;
            let cObj;
            try {
                if (nodeEnvConfPath) {
                    eObj = JSON.parse(readFileSync(nodeEnvConfPath, 'utf8'));
                    if (!isConfigData(eObj)) {
                        this.configCache = null;
                        log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                        throw new Error(`malformed config property in ${path.join(process.cwd(), nodeEnvConfPath)}`);
                    }
                    if (commonConfPath) {
                        cObj = JSON.parse(readFileSync(commonConfPath, 'utf8'));
                        if (isConfigData(cObj)) {
                            this.configCache = Object.assign(Object.assign({}, cObj), eObj);
                        }
                        else {
                            console.warn(`loadFiles(): contents of ${path.join(process.cwd(), commonConfPath)} ignored due to impropper format`);
                            this.configCache = eObj;
                        }
                    }
                    else {
                        console.debug('loadFiles(): common config not provided');
                    }
                }
            }
            catch (err) {
                if (err instanceof Error) {
                    const formattedError = yield prettyFsNotFound(err);
                    log.error(formattedError || err.message);
                }
                else {
                    log.error(err);
                }
            }
            if (!(this.configCache instanceof Object)) {
                throw new Error(`No config loaded: expected ${nodeEnvConfPath !== null && nodeEnvConfPath !== void 0 ? nodeEnvConfPath : '(no path)'} relative to ${process.cwd()} ` +
                    `(NODE_ENV: ${NODE_ENV}). Starter configs live in ./conf/conf-examples/.`);
            }
            return this.configCache;
        });
    }
}
export class DOMConfigUtil extends ConfigBase {
    constructor(conf, pubSafe) {
        super();
        this.pubSafe = pubSafe !== null && pubSafe !== void 0 ? pubSafe : [];
        if (!inBrowser()) {
            if (!conf) {
                throw new Error(`please provide conf param to constructor`);
            }
            else {
                this.configCache = conf;
            }
        }
    }
    get conf() {
        if (!this.configCache) {
            this.configCache = this.extract();
        }
        return this.configCache;
    }
    get pubConf() {
        if (!this.configCache) {
            return undefined;
        }
        const conf = this.configCache;
        return Object.fromEntries(this.pubSafe.filter(key => key in conf).map(key => [key, conf[key]]));
    }
    extract() {
        var _a;
        const conf = (_a = document.getElementById('configData')) === null || _a === void 0 ? void 0 : _a.dataset;
        if (isConfigDataPopulated(conf)) {
            return conf;
        }
        return null;
    }
    populateDOM(req, res, next) {
        if (!this.configCache)
            throw new Error('config cache empty - pass in conf to constructor`');
        res.locals['configData'] = Object.assign(Object.assign({}, this.pubConf), { nodeEnv: NODE_ENV });
        res.locals['camelCaseToDashDelim'] = (prop) => prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        next();
    }
}
//# sourceMappingURL=config.js.map