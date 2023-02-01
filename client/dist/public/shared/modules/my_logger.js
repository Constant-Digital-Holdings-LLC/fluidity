import { LoggerUtil } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
export const composer = (conf) => {
    const { logLevel, locLevel } = conf || {};
    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    }
    else {
        return LoggerUtil.nodeConsole({ logLevel, locLevel });
    }
};
//# sourceMappingURL=my_logger.js.map