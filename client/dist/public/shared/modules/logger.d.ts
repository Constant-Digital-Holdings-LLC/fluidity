import { Runtime } from '#@shared/types.js';
export declare enum LogLevel {
    debug = 0,
    info = 1,
    warn = 2,
    error = 3,
    none = 4
}
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
export declare class ConsoleLogFormatter {
    runtime: Runtime;
    constructor(runtime: Runtime);
}
export declare class Logger {
    loglevel: LogLevel;
    formatter: LogFormatter;
    transport: LogTransport;
    constructor(loglevel: LogLevel, formatter: LogFormatter, transport: LogTransport);
}
export declare function test(): void;
export {};
//# sourceMappingURL=logger.d.ts.map