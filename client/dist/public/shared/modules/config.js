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
export class ConfigUtil {
    constructor(baseConfig = {}) {
        this.baseConfig = baseConfig;
        this.allConf = {};
        this.defaults = {
            app_name: null,
            app_version: null,
            log_level: null,
            loc_level: null,
            node_env: null
        };
        if (inBrowser()) {
            this.baseConfig.app_name = 'fluidity web app';
        }
        this.allConf = Object.freeze(Object.assign(Object.assign({}, this.defaults), this.baseConfig));
    }
    static new(nodeEnv, cFiles) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            if (inBrowser())
                return new ConfigUtil();
            const nodeEnvConfPath = (_a = cFiles[nodeEnv]) === null || _a === void 0 ? void 0 : _a[0];
            const commonConfPath = (_b = cFiles['common']) === null || _b === void 0 ? void 0 : _b[0];
            const { existsSync: exists, readFileSync: read } = yield import('fs');
            if (nodeEnvConfPath && exists(nodeEnvConfPath)) {
                const eObj = (_c = cFiles[nodeEnv]) === null || _c === void 0 ? void 0 : _c[1].parse(read(nodeEnvConfPath, 'utf8'));
                if (eObj) {
                    if (commonConfPath && exists(commonConfPath)) {
                        const cObj = (_d = cFiles['common']) === null || _d === void 0 ? void 0 : _d[1].parse(read(commonConfPath, 'utf8'));
                        if (cObj) {
                            return new ConfigUtil(Object.assign(Object.assign({}, eObj), cObj));
                        }
                    }
                    else {
                        return new ConfigUtil(eObj);
                    }
                }
            }
            return new ConfigUtil();
        });
    }
    static yaml() {
        return __awaiter(this, void 0, void 0, function* () {
            const YAML = yield import('yaml');
            return ConfigUtil.new(process.env['NODE_ENV'] === 'development' ? 'development' : 'production', {
                development: ['./conf/dev_conf.yaml', YAML],
                production: ['./conf/prod_conf.yaml', YAML],
                common: ['./conf/common_conf.yaml', YAML]
            });
        });
    }
    static load() {
        return ConfigUtil.yaml();
    }
    get pubConf() {
        const handler = {
            get(target, prop, receiver) {
                if (typeof prop === 'string')
                    if (ConfigUtil.permitPublic.includes(prop)) {
                        return Reflect.get(target, prop, receiver);
                    }
                    else {
                        return undefined;
                    }
            }
        };
        return new Proxy(this.allConf, handler);
    }
}
ConfigUtil.permitPublic = ['app_name', 'app_version', 'log_level', 'loc_level', 'node_env'];
//# sourceMappingURL=config.js.map