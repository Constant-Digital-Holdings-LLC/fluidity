import { Runtime } from '#@shared/types.js';

const levelsArr = ['debug', 'info', 'warn', 'error'] as const;

type LogLevel = typeof levelsArr[number] & keyof typeof console;

interface LogData<T> {
    level: LogLevel;
    message: T;
    timestamp: Date;
}

interface LogFormatter {
    format<T>(data: LogData<T>, options?: { style?: 'pretty' }): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

class ConsoleLogFormatter {
    constructor(public runtime: Runtime) {}
    format<T>(data: LogData<T>) {
        return `${data} foo`;
    }
}

class ConsoleLogTransport {
    send(level: LogLevel, line: string) {
        console[level].bind(global.console, line);
    }
}

// https://stackoverflow.com/questions/63288162/fluent-api-with-typescript/63288282#63288282
//logger.pretty() //info loglevel
//logger.debug().pretty()
//logger.info()
//logger.debug()
//logger.error() //log trace details by default

export class Logger {
    constructor(public level: LogLevel, public formatter: LogFormatter, public transport: LogTransport) {}

    private shoudLog(level: LogLevel): boolean {
        return levelsArr.indexOf(level) >= levelsArr.indexOf(this.level);
    }
}

//determine runtime and export default the right thing....
export default new Logger('debug', new ConsoleLogFormatter('nodejs'), new ConsoleLogTransport());

export function test(): void {
    console.log('v 9');
}
