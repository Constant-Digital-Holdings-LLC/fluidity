// Application-specific customizations for logger lib:

import { LoggerUtil, levelsArr } from '#@shared/modules/logger.js';
import { inBrowser } from '#@shared/modules/utils.js';
import type { MyConfigData } from '#@shared/modules/my_config.js';

export const composer = (conf?: MyConfigData): LoggerUtil => {
    const { logLevel, locLevel, logFormat } = conf || {};

    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    } else {
        if (levelsArr.indexOf(logLevel || 'debug') >= levelsArr.indexOf('info') && logFormat === 'JSON') {
            return LoggerUtil.JSONEmitter({ logLevel, locLevel });
        } else {
            return LoggerUtil.nodeConsole({ logLevel, locLevel });
        }
    }
};
