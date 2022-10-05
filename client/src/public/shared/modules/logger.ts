// to-do: get the node trace stuff working:
// https://www.npmjs.com/package/stack-trace
//
// make loc info dynamic based on locLevel
//
// make 'pretty JSON' dynamic based on logLevel
//
// expose config module to logger module
//
// if in nodejs runtime, report a warning that loglines may be out of order if trace is on

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
    data: T;
    ts: Date;
    loc?: StackLocation;
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

class ConsoleLogFormatter implements LogFormatter {
    constructor(private runtime: Runtime) {}
    format<T>(data: LogData<T>): string {
        return JSON.stringify(data);
    }
}

class ConsoleLogTransport implements LogTransport {
    constructor(private runtime: Runtime) {}
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

    private log<T>(level: LogLevel, data: T): void {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel)) {
            this.getStackLocation().then(loc => {
                this.transport.send(
                    level,
                    this.formatter.format({
                        level,
                        data,
                        ts: new Date(),
                        loc
                    })
                );
            });
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
        const runtime: Runtime = 'browser';
        return new LoggerUtil(
            levelSettings,
            new ConsoleLogFormatter(runtime),
            new ConsoleLogTransport(runtime),
            runtime
        );
    }

    static nodeConsole(levelSettings: LevelSettings): LoggerUtil {
        const runtime: Runtime = 'nodejs';
        return new LoggerUtil(
            levelSettings,
            new ConsoleLogFormatter(runtime),
            new ConsoleLogTransport(runtime),
            runtime
        );
    }
}

export let logger: Logger;

if (typeof window === 'undefined' && typeof process === 'object') {
    logger = LoggerUtil.nodeConsole({ logLevel: 'debug', locLevel: 'debug' });
} else {
    logger = LoggerUtil.browserConsole({ logLevel: 'debug', locLevel: 'debug' });
}
