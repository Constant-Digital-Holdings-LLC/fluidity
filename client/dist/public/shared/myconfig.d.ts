import type { ConfigData } from '#@shared/modules/config.js';
export interface MyConfigData extends ConfigData {
    readonly tls_key?: string;
    readonly tls_cert?: string;
    readonly http_cache_ttl_seconds?: number;
    readonly port?: number;
}
export declare const pubSafeProps: string[];
export type PubSafeTypes = Pick<MyConfigData, typeof pubSafeProps[number]>;
//# sourceMappingURL=myconfig.d.ts.map