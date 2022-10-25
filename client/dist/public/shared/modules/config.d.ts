import type { Request, Response, NextFunction } from 'express';
import { LogLevel } from '#@shared/modules/logger.js';
declare type NodeEnv = 'development' | 'production';
export interface ConfigData {
    app_name?: string | null;
    app_version?: string | null;
    log_level?: LogLevel | null;
    loc_level?: LogLevel | null;
    node_env?: NodeEnv | null;
    [index: string]: unknown;
}
declare abstract class ConfigBase {
    static pubSafeProps: string[];
    abstract get allConf(): ConfigData | undefined;
    cachedConfig: ConfigData | undefined;
    protected get pubConf(): ConfigData | undefined;
}
export declare class DOMConfigUtil extends ConfigBase {
    private _conf?;
    constructor(_conf?: ConfigData | undefined);
    get allConf(): ConfigData;
    private extract;
    inject(req: Request, res: Response, next: NextFunction): void;
}
export declare const configFromDOM: () => ConfigData;
export declare const configFromFS: () => Promise<ConfigData | undefined>;
export declare const config: () => Promise<ConfigData | undefined>;
export {};
//# sourceMappingURL=config.d.ts.map