import type { LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData } from '#@shared/modules/config.js';
import type { FluidityPacket, PublishTarget } from '#@shared/types.js';
export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
export declare const pubSafe: readonly ["appName", "logLevel", "appVersion", "locLevel", "nodeEnv"];
export declare const confFromDOM: () => MyConfigData | undefined;
export declare const confFromFS: () => Promise<MyConfigData | undefined>;
//# sourceMappingURL=fluidityConfig.d.ts.map