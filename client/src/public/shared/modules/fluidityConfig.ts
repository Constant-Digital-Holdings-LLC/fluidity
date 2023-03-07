//
// Application Specific Customizations of
// Configuration Lib
//
import type { LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData, FSConfigUtil, DOMConfigUtil } from '#@shared/modules/config.js';
import type { FluidityPacket, PublishTarget } from '#@shared/types.js';

export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly permittedKeys?: string[];
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
    readonly maxClientHistory?: number;
    readonly maxServerHistory?: number;
}

// config props which can be exposed to the client (browswer):
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv', 'maxClientHistory'] as const;

export const confFromDOM = () => {
    return new DOMConfigUtil<MyConfigData>().conf;
};
export const confFromFS = async () => {
    return (await FSConfigUtil.asyncNew<MyConfigData>()).conf;
};
