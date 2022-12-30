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
import { inBrowser, prettyFsNotFound } from '#@shared/modules/utils.js';
const log = fetchLogger();
const NODE_ENV = inBrowser() ? null : process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
function isMyConfigData(obj) {
    return obj && obj instanceof Object && Object.keys(obj).every(prop => /^[a-z]+[a-z0-9 _]*$/.test(prop));
}
import { pubSafeProps } from '#@shared/my_config.js';
class ConfigBase {
    get pubConf() {
        const handler = {
            get(target, prop, receiver) {
                if (typeof prop === 'string')
                    if (pubSafeProps.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    }
                    else {
                        return undefined;
                    }
            },
            ownKeys(target) {
                return Object.keys(target).filter(prop => pubSafeProps.includes(prop));
            },
            set() {
                throw new Error('pubConf is immutable.');
            }
        };
        if (this.cachedConfig) {
            return new Proxy(this.cachedConfig, handler);
        }
        else {
            return undefined;
        }
    }
}
class FSConfigUtil extends ConfigBase {
    constructor() {
        super(...arguments);
        this.nodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
    }
    get allConf() {
        return this.cachedConfig;
    }
    load() {
        return this.loadFiles({
            development: ['./conf/dev_conf.json', JSON],
            production: ['./conf/prod_conf.json', JSON],
            common: ['./conf/common_conf.json', JSON]
        });
    }
    loadFiles(cFiles) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            if (!NODE_ENV) {
                throw new Error('loadFiles() not applicable outside of node');
            }
            const nodeEnvConfPath = (_a = cFiles[NODE_ENV]) === null || _a === void 0 ? void 0 : _a[0];
            const commonConfPath = (_b = cFiles['common']) === null || _b === void 0 ? void 0 : _b[0];
            const { readFileSync } = yield import('fs');
            const path = yield import('node:path');
            let eObj;
            let cObj;
            try {
                if (nodeEnvConfPath) {
                    eObj = (_c = cFiles[NODE_ENV]) === null || _c === void 0 ? void 0 : _c[1].parse(readFileSync(nodeEnvConfPath, 'utf8'));
                    if (!isMyConfigData(eObj)) {
                        this.cachedConfig = undefined;
                        log.error(`loadFiles(): Could not parse: ${path.join(process.cwd(), nodeEnvConfPath)}`);
                        throw new Error(`loadFiles(): impropper config file format for this node-env`);
                    }
                    if (commonConfPath) {
                        cObj = (_d = cFiles['common']) === null || _d === void 0 ? void 0 : _d[1].parse(readFileSync(commonConfPath, 'utf8'));
                        if (isMyConfigData(cObj)) {
                            this.cachedConfig = Object.assign(Object.assign({}, eObj), cObj);
                        }
                        else {
                            log.warn(`loadFiles(): contents of ${path.join(process.cwd(), commonConfPath)} ignored due to impropper format`);
                            this.cachedConfig = eObj;
                        }
                    }
                    else {
                        log.debug('loadFiles(): common config not provided');
                    }
                }
            }
            catch (err) {
                if (err instanceof Error) {
                    const formattedError = yield prettyFsNotFound(err);
                    log.error(formattedError || err);
                    log.error(err.stack);
                }
                else {
                    log.error(err);
                }
            }
            return this.cachedConfig;
        });
    }
}
class DOMConfigUtil extends ConfigBase {
    constructor(conf) {
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
    extract() {
        return { app_name: 'Fluidity', log_level: 'debug', foo: 'bar' };
    }
    addLocals(req, res, next) {
        if (!this.cachedConfig)
            throw new Error('addLocals() middleware requires config data for req.locals');
        res.locals['configData'] = this.pubConf;
        res.locals['NODE_ENV'] = NODE_ENV;
        next();
    }
}
export const configFromDOM = () => {
    return new DOMConfigUtil().allConf;
};
export const configFromFS = () => __awaiter(void 0, void 0, void 0, function* () {
    const fsConf = new FSConfigUtil();
    if (inBrowser())
        throw new Error('browser can not access filesystem, use configFromDom()');
    if (!fsConf.allConf) {
        yield fsConf.load();
    }
    return fsConf.allConf;
});
export const config = () => __awaiter(void 0, void 0, void 0, function* () {
    if (inBrowser()) {
        return configFromDOM();
    }
    else {
        return configFromFS();
    }
});
export const configMiddleware = () => __awaiter(void 0, void 0, void 0, function* () {
    const dcu = new DOMConfigUtil(yield new FSConfigUtil().load());
    return dcu.addLocals.bind(dcu);
});
//# sourceMappingURL=config.js.map