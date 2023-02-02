import type { Request, Response, NextFunction } from 'express';
type NodeEnv = 'development' | 'production' | null;
export interface ConfigData {
    readonly appName: string;
    readonly appVersion?: string;
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}
export declare const pubSafeProps: readonly ["appName", "logLevel", "appVersion", "locLevel", "nodeEnv"];
import { MyConfigData } from '#@shared/modules/my_config.js';
export declare const configFromDOM: () => MyConfigData | undefined;
export declare const configFromFS: () => Promise<MyConfigData | undefined>;
export declare const config: () => Promise<MyConfigData | undefined>;
export declare const configMiddleware: () => Promise<(req: Request, res: Response, next: NextFunction) => void>;
export {};
//# sourceMappingURL=config.d.ts.map