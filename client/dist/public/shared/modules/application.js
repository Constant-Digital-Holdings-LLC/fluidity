import { inBrowser } from '#@shared/modules/utils.js';
import { LoggerUtil, levelsArr } from '#@shared/modules/logger.js';
export const fetchLogger = (conf) => {
    return LoggerUtil.new(conf => {
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
    });
};
//# sourceMappingURL=application.js.map