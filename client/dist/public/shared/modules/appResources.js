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
import { LoggerUtil, levelsArr } from '#@shared/modules/logger.js';
import { FSConfigUtil, DOMConfigUtil } from '#@shared/modules/config.js';
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv'];
export const confFromDOM = () => {
    return new DOMConfigUtil();
};
export const confFromFS = () => __awaiter(void 0, void 0, void 0, function* () {
    return yield FSConfigUtil.asyncNew();
});
export const fetchLogger = (conf) => {
    const { logLevel, locLevel, logFormat } = conf || {};
    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    }
    else {
        if (levelsArr.indexOf(logLevel || 'debug') >= levelsArr.indexOf('info') && logFormat === 'JSON') {
            return LoggerUtil.JSONEmitter({ logLevel, locLevel });
        }
        else {
            return LoggerUtil.nodeConsole({ logLevel, locLevel });
        }
    }
};
//# sourceMappingURL=appResources.js.map