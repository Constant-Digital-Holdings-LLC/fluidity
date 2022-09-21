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
//table (in node): - https://www.npmjs.com/package/table
//table (in browser): have main method simply call console.table

interface LogFormatter {
    format<T>(data: LogData<T>, options?: { style?: 'pretty' | 'table' }): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

export class ConsoleLogFormatter {
    constructor(public runtime: Runtime) {}
}

//logger.pretty() //info loglevel
//logger.debug().pretty()
//logger.info().table()
//logger.debug().table()

export class Logger {
    constructor(public loglevel: LogLevel, public formatter: LogFormatter, public transport: LogTransport) {}
}

export function test(): void {
    console.log('v 9');
}
