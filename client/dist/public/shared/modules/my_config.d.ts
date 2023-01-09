import type { ConfigData } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';
export interface MyConfigData extends ConfigData {
    readonly targets?: PublishTarget[];
    readonly tls_key?: string;
    readonly tls_cert?: string;
    readonly http_cache_ttl_seconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
export declare const pubSafeProps: readonly ["app_name", "log_level", "app_version", "loc_level", "node_env"];
//# sourceMappingURL=my_config.d.ts.map