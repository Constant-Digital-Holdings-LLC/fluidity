import type { Request, Response, NextFunction } from 'express';
type NodeEnv = 'development' | 'production' | null;
export interface ConfigData extends Object {
    readonly appName: string;
    readonly appVersion?: string;
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}
interface ConfigParser {
    parse(src: string): unknown;
}
interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}
declare abstract class ConfigBase<C extends ConfigData> {
    abstract get conf(): C | undefined;
    protected configCache: C | undefined;
}
export declare class FSConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    readonly nodeEnv: NodeEnv;
    static asyncNew<C extends ConfigData>(): Promise<FSConfigUtil<C>>;
    get conf(): C | undefined;
    load(): Promise<C | undefined>;
    loadFiles(cFiles: ConfigFiles): Promise<C | undefined>;
}
export declare class DOMConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    protected pubSafe: readonly string[];
    constructor(conf?: C, pubSafe?: readonly string[]);
    get conf(): C | undefined;
    protected get pubConf(): C | undefined;
    protected extract<C extends ConfigData>(): C | undefined;
    populateDOM(req: Request, res: Response, next: NextFunction): void;
}
export {};
//# sourceMappingURL=config.d.ts.map