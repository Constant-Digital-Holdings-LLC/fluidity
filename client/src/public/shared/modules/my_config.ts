import type { ConfigData } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';

// Application Specific Config Options / Overrides for config.ts:
export interface MyConfigData extends ConfigData {
    readonly targets?: PublishTarget[];
    readonly tls_key?: string;
    readonly tls_cert?: string;
    readonly http_cache_ttl_seconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
//These config options can be exposed to the browser
export const pubSafeProps = ['app_name', 'log_level', 'app_version', 'loc_level', 'node_env'] as const;
