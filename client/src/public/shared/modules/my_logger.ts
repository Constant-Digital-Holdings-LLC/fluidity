// Application-specific customizations for logger lib:

import { LoggerUtil } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
import type { ConfigData } from '#@shared/modules/config.js';

export const composer = (conf?: ConfigData): LoggerUtil => {
    const { logLevel, locLevel } = conf || {};

    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    } else {
        return LoggerUtil.nodeConsole({ logLevel, locLevel });
    }
};
