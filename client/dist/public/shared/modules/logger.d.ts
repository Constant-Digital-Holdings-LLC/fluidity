declare const levelsArr: readonly ["debug", "info", "warn", "error"];
declare type LogLevel = typeof levelsArr[number] & keyof typeof console;
interface LogData<T> {
    level: LogLevel;
    message: T;
    timestamp: Date;
}
interface LogFormatter {
    format<T>(data: LogData<T>, options?: {
        style?: 'pretty';
    }): string;
}
interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}
export declare class Logger {
    level: LogLevel;
    private formatter;
    private transport;
    constructor(level: LogLevel, formatter: LogFormatter, transport: LogTransport);
    private log;
    info<T>(data: T): void;
    static browserConsole(level: LogLevel): Logger;
    static nodeConsole(level: LogLevel): Logger;
}
export declare let logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map