import type { ConfigData } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';
export interface MyConfigData extends ConfigData {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
export declare const pubSafeProps: readonly ["appName", "logLevel", "appVersion", "locLevel", "nodeEnv"];
//# sourceMappingURL=my_config.d.ts.map