import { LoggerUtil, LoggerConfig } from '#@shared/modules/logger.js';
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
export declare const fetchLogger: <C extends LoggerConfig>(conf?: C | undefined) => LoggerUtil;
//# sourceMappingURL=application.d.ts.map