import { LogLevel } from '#@shared/modules/logger.js';
declare type NodeEnv = 'development' | 'production';
interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
}
export declare const asyncConfig: () => Promise<ConfigData>;
export declare const syncConfig: () => ConfigData;
export {};
//# sourceMappingURL=config.d.ts.map