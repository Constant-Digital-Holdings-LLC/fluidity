import { Runtime } from '#@shared/types.js';
declare const levelsArr: readonly ["debug", "info", "warn", "error"];
declare type LogLevel = typeof levelsArr[number] & keyof typeof console;
declare type Logger = {
    [K in LogLevel]: <T>(data: T) => void;
};
interface LogData<T> {
    level: LogLevel;
    data: T;
    ts: Date;
    loc?: {
        line: number | undefined;
        file: string | undefined;
    };
}
interface LevelSettings {
    locLevel: LogLevel;
    logLevel: LogLevel;
}
interface LogFormatter {
    format<T>(data: LogData<T>, options?: {
        style?: 'pretty';
    }): string;
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
    private log;
    debug<T>(data: T): void;
    info<T>(data: T): void;
    warn<T>(data: T): void;
    error<T>(data: T): void;
    static browserConsole(levelSettings: LevelSettings): LoggerUtil;
    static nodeConsole(levelSettings: LevelSettings): LoggerUtil;
}
export declare let logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map