import { Runtime } from '#@shared/types.js';

const levelsArr = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = typeof levelsArr[number] & keyof typeof console;
type Logger = { [K in LogLevel]: <T>(data: T) => void };

interface LogData<T> {
    level: LogLevel;
    data: T;
    timestamp: Date;
    location?: string;
}

interface LogFormatter {
    format<T>(data: LogData<T>, options?: { style?: 'pretty' }): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

class ConsoleLogFormatter {
    constructor(private runtime: Runtime) {}
    format<T>(data: LogData<T>): string {
        return JSON.stringify(data);
    }
}

class ConsoleLogTransport {
    constructor(private runtime: Runtime) {}
    send(level: LogLevel, line: string) {
        console[level](line);
    }
}

// https://stackoverflow.com/questions/63288162/fluent-api-with-typescript/63288282#63288282
//logger.pretty() //info loglevel
//logger.debug().pretty()
//logger.info()
//logger.debug()
//logger.error() //log trace details by default

export class LoggerUtil implements Logger {
    constructor(
        public levelSetting: LogLevel,
        private formatter: LogFormatter,
        private transport: LogTransport,
        private runtime: Runtime
    ) {}

    private log<T>(level: LogLevel, data: T): void {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSetting)) {
            let location: string = '';

            try {
                throw Error('');
            } catch (err) {
                if (err instanceof Error) {
                    if (this.runtime === 'browser') {
                        //find out which line in stack trace has logger.js/ts and +1 to find caller. make this more automatic...
                        // location = err.stack?.split('\n')[4];
                    } else {
                        // location = err.stack?.split('\n')[8];
                    }
                }
            }

            this.transport.send(level, this.formatter.format({ level, data, timestamp: new Date(), location }));
        }
    }

    debug<T>(data: T) {
        this.log('debug', data);
    }

    info<T>(data: T) {
        this.log('info', data);
    }

    warn<T>(data: T) {
        this.log('warn', data);
    }

    error<T>(data: T) {
        this.log('error', data);
    }

    static browserConsole(level: LogLevel): Logger {
        const runtime: Runtime = 'browser';
        return new LoggerUtil(level, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }

    static nodeConsole(level: LogLevel): Logger {
        const runtime: Runtime = 'nodejs';
        return new LoggerUtil(level, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }
}

export let logger: Logger;

if (typeof window === 'undefined' && typeof process === 'object') {
    logger = LoggerUtil.nodeConsole('debug');
} else {
    logger = LoggerUtil.browserConsole('debug');
}
