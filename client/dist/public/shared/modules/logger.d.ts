import { Runtime } from '#@shared/types.js';
declare const levelsArr: readonly ["debug", "info", "warn", "error"];
declare type LogLevel = typeof levelsArr[number] & keyof typeof console;
declare type Logger = {
    [K in LogLevel]: <T>(data: T) => void;
};
interface StackLocation {
    line: number | undefined;
    file: string | undefined;
}
interface LogData<T> {
    level: LogLevel;
    message: T;
    timestamp: Date;
    location?: StackLocation | undefined;
}
interface LevelSettings {
    locLevel: LogLevel;
    logLevel: LogLevel;
}
interface LogFormatter {
    format<T>(data: LogData<T>): string;
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
    debug<T>(data: T): void;
    info<T>(data: T): void;
    warn<T>(data: T): void;
    error<T>(data: T): void;
    static browserConsole(levelSettings: LevelSettings): LoggerUtil;
    static nodeConsole(levelSettings: LevelSettings): LoggerUtil;
    static JSONEmitter(levelSettings: LevelSettings): LoggerUtil;
}
export declare let logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map