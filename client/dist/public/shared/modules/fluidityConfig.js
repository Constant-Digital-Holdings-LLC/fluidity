var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { FSConfigUtil, DOMConfigUtil, isConfigDataPopulated } from '#@shared/modules/config.js';
const DEFAULTS = {
    appName: 'Fluidity',
    appVersion: '2.0.0'
};
const versionFromPackageJson = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { readFileSync } = yield import('fs');
        const { fileURLToPath } = yield import('url');
        const pkgPath = fileURLToPath(new URL('../../../../../package.json', import.meta.url));
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return typeof pkg.version === 'string' && pkg.version ? pkg.version : undefined;
    }
    catch (_a) {
        return undefined;
    }
});
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv', 'org'];
export const confFromDOM = () => {
    const c = Object.assign(Object.assign({}, DEFAULTS), new DOMConfigUtil().conf);
    if (isConfigDataPopulated(c)) {
        return c;
    }
    else {
        throw new Error('confFromDOM expected populated config');
    }
};
export const confFromFS = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const appVersion = (_a = (yield versionFromPackageJson())) !== null && _a !== void 0 ? _a : DEFAULTS.appVersion;
    const c = Object.assign(Object.assign(Object.assign({}, DEFAULTS), { appVersion }), (yield FSConfigUtil.asyncNew()).conf);
    if (isConfigDataPopulated(c)) {
        return c;
    }
    else {
        throw new Error('confFromFS expected populated config');
    }
});
//# sourceMappingURL=fluidityConfig.js.map