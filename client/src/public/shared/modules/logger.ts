//
// in SimpleFormatter class, the timestamp format should display
// date (in addition to time) if loglevel *setting is higher than debug
//
// expose config module to logger module
//

import { Runtime } from '#@shared/types.js';
import type { StackFrame } from 'stacktrace-js';

const levelsArr = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = typeof levelsArr[number] & keyof typeof console;
type Logger = { [K in LogLevel]: <T>(data: T) => void };

interface StackLocation {
    line: number | undefined;
    file: string | undefined;
}

interface LogData<T> {
    level: LogLevel;
    message: T;
    timestamp: Date;
    location?: StackLocation | undefined;
}

interface LevelSettings {
    locLevel: LogLevel;
    logLevel: LogLevel;
}

interface LogFormatter {
    format<T>(data: LogData<T>, options?: { style?: 'pretty' }): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

class SimpleFormatter implements LogFormatter {
    constructor() {}
    format<T>(data: LogData<T>): string {
        const { message, timestamp, level } = data;
        let formattedMesg: string;

        if (typeof message !== 'string') {
            formattedMesg = JSON.stringify(message);
        } else {
            formattedMesg = message;
        }

        if (data.location?.file && data.location?.line) {
            const {
                location: { file, line }
            } = data;

            return `[${timestamp.toISOString().slice(11, -1)}]: ${formattedMesg} (${file}:${line})`;
        } else {
            return `[${timestamp.toISOString().slice(11, -1)}]: ${formattedMesg}`;
        }
    }
}

class NodeConsoleFormatter extends SimpleFormatter implements LogFormatter {
    override format<T>(data: LogData<T>): string {
        const map = [94, 97, 33, 91];

        return `\x1b[${map[levelsArr.indexOf(data.level)]}m${super.format(data)}\x1b[0m`;
    }
}

class JSONFormatter implements LogFormatter {
    format<T>(data: LogData<T>): string {
        return JSON.stringify(data);
    }
}

class ConsoleTransport implements LogTransport {
    send(level: LogLevel, line: string) {
        console[level](line);
    }
}

export class LoggerUtil implements Logger {
    constructor(
        private levelSettings: LevelSettings,
        private formatter: LogFormatter,
        private transport: LogTransport,
        private runtime: Runtime
    ) {}

    private getStackLocation(): Promise<StackLocation> {
        return new Promise((resolve, reject) => {
            if (this.runtime === 'browser') {
                StackTrace.get()
                    .then((sf: StackFrame[]) => {
                        resolve({
                            file: sf[4]?.fileName?.split('/').slice(-1).toString(),
                            line: sf[4]?.lineNumber
                        });
                    })
                    .catch((err: Error) => {
                        reject(err);
                    });
            } else {
                try {
                    throw new Error('get logger.ts telemetry');
                } catch (err) {
                    import('stack-trace').then(v8Strace => {
                        if (err instanceof Error) {
                            const sf = v8Strace.parse(err);

                            resolve({
                                file: sf[5]?.getFileName().split('/').slice(-1).toString(),
                                line: sf[5]?.getLineNumber()
                            });
                        }
                    });
                }
            }
        });
    }

    private log<T>(level: LogLevel, message: T): void {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel)) {
            const snd = (location?: StackLocation) => {
                this.transport.send(
                    level,
                    this.formatter.format({
                        level,
                        message,
                        timestamp: new Date(),
                        location
                    })
                );
            };

            if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.locLevel)) {
                this.getStackLocation().then(snd);
            } else {
                snd();
            }
        }
    }

    debug<T>(data: T): void {
        this.log('debug', data);
    }

    info<T>(data: T): void {
        this.log('info', data);
    }

    warn<T>(data: T): void {
        this.log('warn', data);
    }

    error<T>(data: T): void {
        this.log('error', data);
    }

    static browserConsole(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(levelSettings, new SimpleFormatter(), new ConsoleTransport(), 'browser');
    }

    static nodeConsole(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(levelSettings, new NodeConsoleFormatter(), new ConsoleTransport(), 'nodejs');
    }

    static EmitJSON(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(levelSettings, new JSONFormatter(), new ConsoleTransport(), 'nodejs');
    }
}

export let logger: Logger;

if (typeof window === 'undefined' && typeof process === 'object') {
    logger = LoggerUtil.nodeConsole({ logLevel: 'debug', locLevel: 'warn' });
} else {
    logger = LoggerUtil.browserConsole({ logLevel: 'debug', locLevel: 'warn' });
}
