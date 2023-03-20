import type { LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData } from '#@shared/modules/config.js';
import type { FluidityPacket, PublishTarget } from '#@shared/types.js';
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
export declare const pubSafe: readonly ["appName", "logLevel", "appVersion", "locLevel", "nodeEnv", "org"];
export declare const confFromDOM: () => MyConfigData;
export declare const confFromFS: () => Promise<MyConfigData>;
//# sourceMappingURL=fluidityConfig.d.ts.map