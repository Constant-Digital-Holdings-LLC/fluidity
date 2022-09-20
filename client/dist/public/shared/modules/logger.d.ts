declare enum LogLevel {
    trace = 0,
    debug = 1,
    info = 2,
    warn = 3,
    error = 4,
    critical = 5,
    none = 6
}
interface LogData {
    level: LogLevel;
    message: unknown;
    timestamp: Date;
}
interface LogFormatter {
    format(data: LogData): string;
}
interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}
export declare class Logger {
    formatter: LogFormatter;
    transport: LogTransport;
    constructor(formatter: LogFormatter, transport: LogTransport);
}
export declare function test(): void;
export {};
//# sourceMappingURL=logger.d.ts.map