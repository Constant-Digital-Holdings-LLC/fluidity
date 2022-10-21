import { LogLevel } from '#@shared/modules/logger.js';
declare type NodeEnv = 'development' | 'production';
interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
}
export declare class ConfigUtil {
    private baseConfig;
    allConf: ConfigData;
    static readonly permitPublic: string[];
    private readonly defaults;
    constructor(baseConfig?: ConfigData);
    private static new;
    private static yaml;
    static load(): Promise<ConfigUtil>;
    private get pubConf();
}
export {};
//# sourceMappingURL=config.d.ts.map