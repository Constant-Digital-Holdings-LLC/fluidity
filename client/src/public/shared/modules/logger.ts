import type { StackFrame } from 'stacktrace-js';
import type { Request, Response, NextFunction } from 'express';
import { inBrowser, counter } from '#@shared/modules/utils.js';
export const levelsArr = ['debug', 'info', 'warn', 'error', 'never'] as const;
export type LogLevel = typeof levelsArr[number];
type Logger = { [K in LogLevel]: <T>(data: T) => void };

export interface LoggerConfig {
    readonly logLevel?: LogLevel;
    readonly locLevel?: LogLevel;
    readonly logFormat?: 'JSON' | 'unstructured';
}

export type Runtime = 'nodejs' | 'browser';

interface StackLocation {
    line: number | undefined;
    file: string | undefined;
}

interface LogData {
    level: LogLevel;
    message: unknown;
    timestamp: Date;
    location?: StackLocation | undefined;
}

interface LevelSettings {
    locLevel: LogLevel | undefined | null;
    logLevel: LogLevel | undefined | null;
}

interface LogFormatter {
    format(data: LogData): string;
}

interface LogTransport {
    send(loglevel: LogLevel, logline: string): void;
}

abstract class FormatterBase implements LogFormatter {
    constructor(protected levelSettings: LevelSettings) {}

    abstract dateString(date: Date): string;

    format(data: LogData): string {
        const { message, timestamp, level } = data;
        let formattedMesg: string = '';

        if (typeof message === 'string') {
            formattedMesg = message;
        } else if (level === 'debug' || this.levelSettings.logLevel === 'debug') {
            formattedMesg = JSON.stringify(message, undefined, '\t');
        } else {
            formattedMesg = JSON.stringify(message);
        }

        if (message instanceof Error) {
            formattedMesg += `\nstack-->\n${message.stack} <--stack`;
        }

        if (data.location?.file && data.location?.line) {
            const {
                location: { file, line }
            } = data;

            return `[${this.dateString(timestamp)}]: ${formattedMesg} (${file}:${line})`;
        } else {
            return `[${this.dateString(timestamp)}]: ${formattedMesg}`;
        }
    }
}

class SimpleConsoleFormatter extends FormatterBase implements LogFormatter {
    dateString(date: Date): string {
        if (this.levelSettings.logLevel === 'debug') {
            return date.toISOString().slice(11, -1);
        } else {
            return date.toISOString();
        }
    }
}

class BrowserConsoleFormatter extends FormatterBase implements LogFormatter {
    dateString(date: Date): string {
        return date.toISOString().slice(11, -1);
    }
}

class NodeConsoleFormatter extends SimpleConsoleFormatter implements LogFormatter {
    override format(data: LogData): string {
        const colorLevels: number[] = [94, 97, 33, 91];

        return super
            .format(data)
            .split(/\r?\n/)
            .map(l => `\x1b[${colorLevels[levelsArr.indexOf(data.level)]}m${l}\x1b[0m`)
            .join('\n');
    }
}

class JSONFormatter implements LogFormatter {
    constructor(protected levelSettings: LevelSettings) {}
    format(data: LogData): string {
        const { message: m, ...rest } = data;

        if (typeof m === 'string') {
            const message = m.replace(/[\t\n]/g, ' ');
            return JSON.stringify({ message, ...rest });
        }
        return JSON.stringify(data);
    }
}

class ConsoleTransport implements LogTransport {
    send(level: LogLevel, line: string) {
        if (level !== 'never') console[level](line);
    }
}

export class LoggerUtil implements Logger {
    constructor(
        private levelSettings: LevelSettings,
        private formatter: LogFormatter,
        private transport: LogTransport,
        private runtime: Runtime
    ) {
        Boolean(levelSettings.locLevel) &&
            levelSettings.locLevel !== 'never' &&
            this.log('warn', 'Performance degraded due to location tracing\n');
    }

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
                    throw new Error('generate stack');
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

    private log(level: LogLevel, message: unknown): void {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel || 'debug')) {
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

            if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.locLevel || 'never')) {
                //warning - setting locLevel to any level other than 'never' can cause delayed logging
                this.getStackLocation().then(snd);
            } else {
                snd();
            }
        }
    }

    debug(data: unknown): void {
        this.log('debug', data);
    }

    info(data: unknown): void {
        this.log('info', data);
    }

    warn(data: unknown): void {
        this.log('warn', data);
    }

    error(data: unknown): void {
        this.log('error', data);
    }

    never(data: unknown): void {}

    static browserConsole(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(
            levelSettings,
            new BrowserConsoleFormatter(levelSettings),
            new ConsoleTransport(),
            'browser'
        );
    }

    static nodeConsole(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(levelSettings, new NodeConsoleFormatter(levelSettings), new ConsoleTransport(), 'nodejs');
    }

    static JSONEmitter(levelSettings: LevelSettings): LoggerUtil {
        return new LoggerUtil(levelSettings, new JSONFormatter(levelSettings), new ConsoleTransport(), 'nodejs');
    }
}

export const httpLogger = (log: LoggerUtil) => {
    let timeSum = 0;
    let reqCount = counter();

    const getDurationInMilliseconds = (start: [number, number]) => {
        const NS_PER_SEC = 1e9;
        const NS_TO_MS = 1e6;
        const diff = process.hrtime(start);

        return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
    };

    return (req: Request, res: Response, next: NextFunction) => {
        const start = process.hrtime();

        res.on('finish', () => {
            const durationInMilliseconds = getDurationInMilliseconds(start);

            timeSum += durationInMilliseconds;

            const averageReqTime = timeSum / reqCount.next().value;

            const logMesg = `${req.method} ${req.url}\t[${
                res.statusCode
            }]\t${durationInMilliseconds.toLocaleString()} ms`;

            if (res.statusCode >= 500 && res.statusCode <= 599) {
                log.error(logMesg);
            } else if (durationInMilliseconds > averageReqTime * 3) {
                log.warn(logMesg);
            } else {
                log.info(logMesg);
            }
        });

        next();
    };
};

const foo = console;

export const fetchLogger = <C extends LoggerConfig>(conf?: C | null): LoggerUtil => {
    const { logLevel, locLevel, logFormat } = conf || {};

    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    } else {
        if (levelsArr.indexOf(logLevel || 'debug') >= levelsArr.indexOf('info') && logFormat === 'JSON') {
            return LoggerUtil.JSONEmitter({ logLevel, locLevel });
        } else {
            return LoggerUtil.nodeConsole({ logLevel, locLevel });
        }
    }
};
