import { LoggerUtil, levelsArr } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
export const composer = (conf) => {
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
//# sourceMappingURL=my_logger.js.map