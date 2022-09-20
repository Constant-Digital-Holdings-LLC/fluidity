interface LogData {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: unknown; //could be obj, array or string?
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

export class Logger {
    constructor(public formatter: LogFormatter, public transport: LogTransport) {}
}

export function test(): void {
    console.log('v 9');
}
