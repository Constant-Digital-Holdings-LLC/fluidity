enum LogLevel {
    trace,
    debug,
    info,
    warn,
    error,
    critical,
    none
}

interface LogData {
    level: LogLevel;
    message: unknown; //could be obj, array or string?
    timestamp: Date;
}

interface LogFormatter {
    format(data: LogData): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

export class Logger {
    constructor(public formatter: LogFormatter, public transport: LogTransport) {}
}

export function test(): void {
    console.log('v 9');
}
