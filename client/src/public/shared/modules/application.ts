//
// Application Specific Customizations for Logging and Configuration Libs
//

import { inBrowser } from '#@shared/modules/utils.js';
import { LoggerUtil, LoggerConfig, levelsArr } from '#@shared/modules/logger.js';

// customize config lib:
import type { ConfigData } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';

export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}

//customize logger lib:
export const fetchLogger = (conf?: LoggerConfig): LoggerUtil => {
    return LoggerUtil.new(conf => {
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
    });
};
