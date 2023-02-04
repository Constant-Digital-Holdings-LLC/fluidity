import { LoggerUtil, LoggerConfig } from '#@shared/modules/logger.js';
import { ConfigData, FSConfigUtil, DOMConfigUtil } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';
export interface MyConfigData extends ConfigData, LoggerConfig {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
export declare const pubSafe: readonly ["appName", "logLevel", "appVersion", "locLevel", "nodeEnv"];
export declare const confFromDOM: () => DOMConfigUtil<MyConfigData>;
export declare const confFromFS: () => Promise<FSConfigUtil<MyConfigData>>;
export declare const fetchLogger: <C extends LoggerConfig>(conf?: C | undefined) => LoggerUtil;
//# sourceMappingURL=appResources.d.ts.map