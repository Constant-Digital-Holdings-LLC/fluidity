const levelsArr = ['debug', 'info', 'warn', 'error'];
class ConsoleLogFormatter {
    constructor(runtime) {
        this.runtime = runtime;
    }
    format(data) {
        return JSON.stringify(data);
    }
}
class ConsoleLogTransport {
    constructor(runtime) {
        this.runtime = runtime;
    }
    send(level, line) {
        console[level](line);
    }
}
export class LoggerUtil {
    constructor(levelSettings, formatter, transport, runtime) {
        this.levelSettings = levelSettings;
        this.formatter = formatter;
        this.transport = transport;
        this.runtime = runtime;
    }
    getStackLocation() {
        return new Promise((resolve, reject) => {
            if (this.runtime === 'browser') {
                StackTrace.get()
                    .then((sf) => {
                    var _a, _b, _c;
                    resolve({
                        file: (_b = (_a = sf[4]) === null || _a === void 0 ? void 0 : _a.fileName) === null || _b === void 0 ? void 0 : _b.split('/').slice(-1).toString(),
                        line: (_c = sf[4]) === null || _c === void 0 ? void 0 : _c.lineNumber
                    });
                })
                    .catch((err) => {
                    reject(err);
                });
            }
            else {
                try {
                    throw new Error('get logger.ts telemetry');
                }
                catch (err) {
                    import('stack-trace').then(v8Strace => {
                        var _a, _b;
                        if (err instanceof Error) {
                            const sf = v8Strace.parse(err);
                            resolve({
                                file: (_a = sf[5]) === null || _a === void 0 ? void 0 : _a.getFileName().split('/').slice(-1).toString(),
                                line: (_b = sf[5]) === null || _b === void 0 ? void 0 : _b.getLineNumber()
                            });
                        }
                    });
                }
            }
        });
    }
    log(level, data) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel)) {
            const sendData = (loc) => {
                this.transport.send(level, this.formatter.format({
                    level,
                    data,
                    ts: new Date(),
                    loc
                }));
            };
            if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.locLevel)) {
                this.getStackLocation().then(sendData);
            }
            else {
                sendData();
            }
        }
    }
    debug(data) {
        this.log('debug', data);
    }
    info(data) {
        this.log('info', data);
    }
    warn(data) {
        this.log('warn', data);
    }
    error(data) {
        this.log('error', data);
    }
    static browserConsole(levelSettings) {
        const runtime = 'browser';
        return new LoggerUtil(levelSettings, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }
    static nodeConsole(levelSettings) {
        const runtime = 'nodejs';
        return new LoggerUtil(levelSettings, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }
}
export let logger;
if (typeof window === 'undefined' && typeof process === 'object') {
    logger = LoggerUtil.nodeConsole({ logLevel: 'debug', locLevel: 'warn' });
}
else {
    logger = LoggerUtil.browserConsole({ logLevel: 'debug', locLevel: 'warn' });
}
//# sourceMappingURL=logger.js.map