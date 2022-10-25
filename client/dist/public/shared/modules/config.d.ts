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
export declare const configFromDOM: () => ConfigData;
export declare const configFromFS: () => Promise<ConfigData | undefined>;
export declare const config: () => Promise<ConfigData | undefined>;
export declare const configMiddleware: (_conf: ConfigData) => Promise<(req: Request, res: Response, next: NextFunction) => void>;
export {};
//# sourceMappingURL=config.d.ts.map