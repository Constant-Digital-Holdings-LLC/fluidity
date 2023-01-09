import type { Request, Response, NextFunction } from 'express';
import { LogLevel } from '#@shared/modules/logger.js';
type NodeEnv = 'development' | 'production' | null;
export interface ConfigData {
    readonly app_name: string;
    readonly app_version?: string;
    readonly log_level?: LogLevel;
    readonly loc_level?: LogLevel;
    readonly node_env?: NodeEnv;
    readonly [index: string]: unknown;
}
import { MyConfigData } from '#@shared/my_config.js';
export declare const configFromDOM: () => MyConfigData | undefined;
export declare const configFromFS: () => Promise<MyConfigData | undefined>;
export declare const config: () => Promise<MyConfigData | undefined>;
export declare const configMiddleware: () => Promise<(req: Request, res: Response, next: NextFunction) => void>;
export {};
//# sourceMappingURL=config.d.ts.map