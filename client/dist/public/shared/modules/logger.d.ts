import type { Request, Response, NextFunction } from 'express';
export declare const levelsArr: readonly ["debug", "info", "warn", "error", "never"];
export type LogLevel = (typeof levelsArr)[number];
type Logger = {
    [K in LogLevel]: <T>(data: T) => void;
};
export interface LoggerConfig {
    readonly logLevel?: LogLevel;
    readonly locLevel?: LogLevel;
    readonly logFormat?: 'JSON' | 'unstructured';
}
export type Runtime = 'nodejs' | 'browser';
interface StackLocation {
    line: number | undefined;
    file: string | undefined;
}
interface LogData {
    level: LogLevel;
    message: unknown;
    timestamp: Date;
    location?: StackLocation | undefined;
}
interface LevelSettings {
    locLevel: LogLevel | undefined | null;
    logLevel: LogLevel | undefined | null;
}
interface LogFormatter {
    format(data: LogData): string;
}
interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}
export declare class LoggerUtil implements Logger {
    private levelSettings;
    private formatter;
    private transport;
    private runtime;
    constructor(levelSettings: LevelSettings, formatter: LogFormatter, transport: LogTransport, runtime: Runtime);
    private getStackLocation;
    private log;
    debug(data: unknown): void;
    info(data: unknown): void;
    warn(data: unknown): void;
    error(data: unknown): void;
    never(data: unknown): void;
    static browserConsole(levelSettings: LevelSettings): LoggerUtil;
    static nodeConsole(levelSettings: LevelSettings): LoggerUtil;
    static JSONEmitter(levelSettings: LevelSettings): LoggerUtil;
}
export declare const httpLogger: (log: LoggerUtil) => (req: Request, res: Response, next: NextFunction) => void;
export declare const fetchLogger: <C extends LoggerConfig>(conf?: C | null | undefined) => LoggerUtil;
export {};
//# sourceMappingURL=logger.d.ts.map