var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { inBrowser } from '#@shared/modules/utils.js';
function isConfigData(obj) {
    return obj && obj instanceof Object;
}
class ConfigBase {
    get pubConf() {
        const handler = {
            get(target, prop, receiver) {
                if (typeof prop === 'string')
                    if (ConfigBase.pubSafeProps.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    }
                    else {
                        return undefined;
                    }
            },
            ownKeys(target) {
                return Object.keys(target).filter(prop => ConfigBase.pubSafeProps.includes(prop));
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
ConfigBase.pubSafeProps = ['app_name', 'log_level', 'app_version', 'loc_level', 'node_env'];
class FSConfigUtil extends ConfigBase {
    constructor() {
        super(...arguments);
        this.nodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
    }
    get allConf() {
        return this.cachedConfig;
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            const YAML = yield import('yaml');
            const cFiles = {
                development: ['./conf/dev_conf.yaml', YAML],
                production: ['./conf/prod_conf.yaml', YAML],
                common: ['./conf/common_conf.yaml', YAML]
            };
            return this.loadFiles(cFiles);
        });
    }
    foo() {
        /^[A-Za-z0-9 _]*$/.test('words');
    }
    loadFiles(cFiles) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            const nodeEnvConfPath = (_a = cFiles[this.nodeEnv]) === null || _a === void 0 ? void 0 : _a[0];
            const commonConfPath = (_b = cFiles['common']) === null || _b === void 0 ? void 0 : _b[0];
            const { existsSync: exists, readFileSync: read } = yield import('fs');
            const isValid = (obj) => {
                return Object.keys(obj).some(prop => /^[a-z]+[a-z0-9 _]*$/.test(prop));
            };
            if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
                const eObj = (_c = cFiles[this.nodeEnv]) === null || _c === void 0 ? void 0 : _c[1].parse(read(nodeEnvConfPath, 'utf8'));
                if (eObj && isValid(eObj)) {
                    if (commonConfPath && exists(commonConfPath)) {
                        const cObj = (_d = cFiles['common']) === null || _d === void 0 ? void 0 : _d[1].parse(read(commonConfPath, 'utf8'));
                        if (cObj && isValid(cObj)) {
                            this.cachedConfig = Object.assign(Object.assign({}, eObj), cObj);
                        }
                    }
                    else {
                        if (isConfigData(eObj))
                            this.cachedConfig = eObj;
                    }
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
        return { log_level: 'debug', foo: 'bar' };
    }
    addLocals(req, res, next) {
        if (!this.cachedConfig)
            throw new Error('addLocals() requires ConfigData for req flow insertion');
        res.locals['configData'] = this.pubConf;
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