import type { ConfigData } from '#@shared/modules/config.js';
export interface MyConfigData extends ConfigData {
    readonly tls_key?: string;
    readonly tls_cert?: string;
    readonly http_cache_ttl_seconds?: number;
    readonly port?: number;
}
export declare const pubSafeProps: readonly ["app_name", "log_level", "app_version", "loc_level", "node_env"];
//# sourceMappingURL=my_config.d.ts.map