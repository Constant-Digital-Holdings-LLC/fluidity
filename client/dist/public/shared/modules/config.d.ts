import type { Request, Response, NextFunction } from 'express';
import { LogLevel } from '#@shared/modules/logger.js';
type NodeEnv = 'development' | 'production' | null;
export interface ConfigData {
    readonly appName: string;
    readonly appVersion?: string;
    readonly logLevel?: LogLevel;
    readonly locLevel?: LogLevel;
    readonly logFormat?: 'JSON' | 'unstructured';
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}
import { MyConfigData } from '#@shared/modules/my_config.js';
export declare const configFromDOM: () => MyConfigData | undefined;
export declare const configFromFS: () => Promise<MyConfigData | undefined>;
export declare const config: () => Promise<MyConfigData | undefined>;
export declare const configMiddleware: () => Promise<(req: Request, res: Response, next: NextFunction) => void>;
export {};
//# sourceMappingURL=config.d.ts.map