interface LogData {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: unknown;
    timestamp: Date;
}
interface LogFormatter {
    format(data: LogData): string;
}
interface LogTransport {
    debug(logline: string): void;
    info(logline: string): void;
    warn(logline: string): void;
    error(logline: string): void;
}
export declare class Logger {
    formatter: LogFormatter;
    transport: LogTransport;
    constructor(formatter: LogFormatter, transport: LogTransport);
}
export declare function test(): void;
export {};
//# sourceMappingURL=logger.d.ts.map