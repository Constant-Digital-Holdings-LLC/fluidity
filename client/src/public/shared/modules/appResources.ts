//
// appResources.ts: Application Specific Customizations of
// Logging and Configuration Libraries
//
import { inBrowser } from '#@shared/modules/utils.js';
import { LoggerUtil, LoggerConfig, levelsArr } from '#@shared/modules/logger.js';
import { ConfigData, FSConfigUtil, DOMConfigUtil } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';

// customize config lib:
export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}

// config props which can be exposed to the client (browswer):
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv'] as const;

export const confFromDOM = () => {
    return new DOMConfigUtil<MyConfigData>();
};
export const confFromFS = async () => {
    return await FSConfigUtil.asyncNew<MyConfigData>();
};

//customize logger lib:
export const fetchLogger = <C extends LoggerConfig>(conf?: C): LoggerUtil => {
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
