import type { LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData, FSConfigUtil, DOMConfigUtil, isConfigDataPopulated } from '#@shared/modules/config.js';
import type { FluidityPacket, PublishTarget } from '#@shared/types.js';

//
// Application Specific Customizations of
// Configuration Lib Below:
//
export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly org?: string;
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

const DEFAULTS: MyConfigData = {
    appName: 'Fluidity',
    appVersion: '1.0.2'
};

// config props which can be exposed to the client (browswer):
export const pubSafe = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv', 'org'] as const;

// two main utils for retrieving config:
export const confFromDOM = (): MyConfigData => {
    const c = { ...DEFAULTS, ...new DOMConfigUtil<MyConfigData>().conf };
    if (isConfigDataPopulated<MyConfigData>(c)) {
        return c;
    } else {
        throw new Error('confFromDOM expected populated config');
    }
};
export const confFromFS = async (): Promise<MyConfigData> => {
    const c = { ...DEFAULTS, ...(await FSConfigUtil.asyncNew<MyConfigData>()).conf };
    if (isConfigDataPopulated<MyConfigData>(c)) {
        return c;
    } else {
        throw new Error('confFromFS expected populated config');
    }
};
