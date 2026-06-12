import { FSConfigUtil, ConfigData } from '#@shared/modules/config.js';
import type { LoggerConfig } from '#@shared/modules/logger.js';
import type { RunnerLimits } from './alertRunner.js';

export interface WatcherConfigData extends ConfigData, LoggerConfig {
    watch: string; //the Fluidity server base URL to subscribe to, e.g. https://localhost:3000
    insecure?: boolean; //relax TLS for a self-signed dev server (loopback only by default)
    alerts?: unknown[]; //raw rule stanzas, validated by parseRules
    evalIntervalMs?: number; //silence/coalesce check cadence (default 1000)
    limits?: Partial<RunnerLimits>; //exec-pool bounds (merged over DEFAULT_LIMITS)
}

export const confFromFS = async (): Promise<WatcherConfigData> => {
    const c = (await FSConfigUtil.asyncNew<WatcherConfigData>()).conf;
    if (!c) throw new Error('watcher: missing or empty config');
    if (typeof c.watch !== 'string' || !c.watch) {
        throw new Error('watcher: conf.watch (the server base URL to subscribe to) is required');
    }
    return c;
};
