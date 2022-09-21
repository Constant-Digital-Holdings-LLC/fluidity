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
    formatter: LogFormatter;
    transport: LogTransport;
    constructor(level: LogLevel, formatter: LogFormatter, transport: LogTransport);
    private shoudLog;
}
declare const _default: Logger;
export default _default;
export declare function test(): void;
//# sourceMappingURL=logger.d.ts.map