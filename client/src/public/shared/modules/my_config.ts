import type { ConfigData } from '#@shared/modules/config.js';

// Application Specific Config Options / Overrides for config.ts:

export interface MyConfigData extends ConfigData {
    readonly tls_key?: string;
    readonly tls_cert?: string;
    readonly http_cache_ttl_seconds?: number;
    readonly port?: number;
}

//These config options can be exposed to the browser
export const pubSafeProps = ['app_name', 'log_level', 'app_version', 'loc_level', 'node_env'];
