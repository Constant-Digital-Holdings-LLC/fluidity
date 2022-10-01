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
    constructor(levelSetting, formatter, transport, runtime) {
        this.levelSetting = levelSetting;
        this.formatter = formatter;
        this.transport = transport;
        this.runtime = runtime;
    }
    log(level, data) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSetting)) {
            let location = 'zaz';
            if (this.runtime === 'browser') {
                StackTrace.get()
                    .then((sf) => {
                    var _a, _b, _c;
                    location = `${(_b = (_a = sf[2]) === null || _a === void 0 ? void 0 : _a.fileName) === null || _b === void 0 ? void 0 : _b.split('/').slice(-1)}:${(_c = sf[2]) === null || _c === void 0 ? void 0 : _c.lineNumber}`;
                    this.transport.send(level, this.formatter.format({ level, data, timestamp: new Date(), location }));
                })
                    .catch((err) => {
                    console.error(err);
                });
            }
            else {
                this.transport.send(level, this.formatter.format({ level, data, timestamp: new Date(), location }));
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
    static browserConsole(level) {
        const runtime = 'browser';
        return new LoggerUtil(level, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }
    static nodeConsole(level) {
        const runtime = 'nodejs';
        return new LoggerUtil(level, new ConsoleLogFormatter(runtime), new ConsoleLogTransport(runtime), runtime);
    }
}
export let logger;
if (typeof window === 'undefined' && typeof process === 'object') {
    logger = LoggerUtil.nodeConsole('debug');
}
else {
    logger = LoggerUtil.browserConsole('debug');
}
//# sourceMappingURL=logger.js.map