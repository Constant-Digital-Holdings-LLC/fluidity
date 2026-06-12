import type { NodeEnv } from '#@shared/types.js';
export declare const inBrowser: () => boolean;
export declare const nodeEnv: () => NodeEnv;
export declare const isErrnoException: (object: Error) => object is NodeJS.ErrnoException;
export declare function counter(): IterableIterator<number>;
export declare const prettyFsNotFound: (err: Error) => Promise<string | undefined>;
//# sourceMappingURL=utils.d.ts.map