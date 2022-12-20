export declare const inBrowser: () => Boolean;
export declare const isErrnoException: (object: Error) => object is NodeJS.ErrnoException;
export declare const prettyFsNotFound: (err: Error) => Promise<string | undefined>;
export type WithRequired<T, K extends keyof T> = T & {
    [P in K]-?: T[P];
};
//# sourceMappingURL=utils.d.ts.map