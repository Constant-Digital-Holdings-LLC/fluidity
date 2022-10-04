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
    log(level, data) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel)) {
            if (this.runtime === 'browser') {
                StackTrace.get()
                    .then((sf) => {
                    var _a, _b, _c;
                    this.transport.send(level, this.formatter.format({
                        level,
                        data,
                        ts: new Date(),
                        loc: { file: (_b = (_a = sf[2]) === null || _a === void 0 ? void 0 : _a.fileName) === null || _b === void 0 ? void 0 : _b.split('/').slice(-1).toString(), line: (_c = sf[2]) === null || _c === void 0 ? void 0 : _c.lineNumber }
                    }));
                })
                    .catch((err) => {
                    console.error(err);
                });
            }
            else {
                this.transport.send(level, this.formatter.format({ level, data, ts: new Date(), loc: { file: 'foo', line: 47 } }));
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
    logger = LoggerUtil.nodeConsole({ logLevel: 'debug', locLevel: 'debug' });
}
else {
    logger = LoggerUtil.browserConsole({ logLevel: 'debug', locLevel: 'debug' });
}
//# sourceMappingURL=logger.js.map