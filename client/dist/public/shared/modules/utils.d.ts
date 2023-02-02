/// <reference types="node" resolution-mode="require"/>
import { LoggerUtil } from '#@shared/modules/logger.js';
import { ConfigData } from '#@shared/modules/config.js';
export declare const inBrowser: () => Boolean;
export declare const isErrnoException: (object: Error) => object is NodeJS.ErrnoException;
export declare const prettyFsNotFound: (err: Error) => Promise<string | undefined>;
export type WithRequired<T, K extends keyof T> = T & {
    [P in K]-?: T[P];
};
export declare const isJSONString: (str: string) => boolean;
export declare const fetchLogger: (conf?: ConfigData) => LoggerUtil;
//# sourceMappingURL=utils.d.ts.map