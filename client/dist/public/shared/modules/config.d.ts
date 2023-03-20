import type { Request, Response, NextFunction } from 'express';
import { NodeEnv } from '#@shared/types.js';
export interface ConfigData {
    readonly appName: string;
    readonly appVersion: string;
    readonly nodeEnv?: NodeEnv;
    readonly [index: string]: unknown;
}
export declare const isConfigData: <C extends ConfigData>(item: unknown) => item is C;
export declare const isConfigDataPopulated: <C extends ConfigData>(obj: unknown) => obj is C;
interface ConfigParser {
    parse(src: string): unknown;
}
interface ConfigFiles {
    readonly common: [string, ConfigParser] | null;
    readonly development: [string, ConfigParser] | null;
    readonly production: [string, ConfigParser] | null;
}
declare abstract class ConfigBase<C extends ConfigData> {
    abstract get conf(): C | null;
    protected configCache: C | null;
    constructor();
}
export declare class FSConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    readonly nodeEnv: NodeEnv;
    static asyncNew<C extends ConfigData>(): Promise<FSConfigUtil<C>>;
    get conf(): C | null;
    load(): Promise<C | undefined>;
    loadFiles(cFiles: ConfigFiles): Promise<C | undefined>;
}
export declare class DOMConfigUtil<C extends ConfigData> extends ConfigBase<C> {
    protected pubSafe: readonly string[];
    constructor(conf?: C, pubSafe?: readonly string[]);
    get conf(): C | null;
    protected get pubConf(): C | undefined;
    protected extract<C extends ConfigData>(): C | null;
    populateDOM(req: Request, res: Response, next: NextFunction): void;
}
export {};
//# sourceMappingURL=config.d.ts.map