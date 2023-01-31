import type { ConfigData } from '#@shared/modules/config.js';
import { FluidityPacket, PublishTarget } from '#@shared/types.js';

// Application Specific Config Options / Overrides for config.ts:
export interface MyConfigData extends ConfigData {
    readonly targets?: PublishTarget[];
    readonly tlsKey?: string;
    readonly tlsCert?: string;
    readonly httpCacheTTLSeconds?: number;
    readonly port?: number;
    readonly site?: Pick<FluidityPacket, 'site'>;
}
//These config options can be exposed to the browser
export const pubSafeProps = ['appName', 'logLevel', 'appVersion', 'locLevel', 'nodeEnv'] as const;
