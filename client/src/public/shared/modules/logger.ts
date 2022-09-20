import { Runtime } from '#@shared/types.js';

export enum LogLevel {
    debug,
    info,
    warn,
    error,
    none
}

interface LogData<T> {
    level: LogLevel;
    message: T;
    timestamp: Date;
}

//pretty - https://github.com/Chris-Baker/pretty-print-object

interface LogFormatter {
    format<T>(data: LogData<T>, options?: { style?: 'pretty' }): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

export class ConsoleLogFormatter {
    constructor(public runtime: Runtime) {}
}

export class Logger {
    constructor(public loglevel: LogLevel, public formatter: LogFormatter, public transport: LogTransport) {}
}

export function test(): void {
    console.log('v 9');
}
