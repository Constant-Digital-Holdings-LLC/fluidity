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
        var _a, _b;
        try {
            throw Error('');
        }
        catch (err) {
            if (err instanceof Error) {
                if (this.runtime === 'browser') {
                    console[level](`${line} ${(_a = err.stack) === null || _a === void 0 ? void 0 : _a.split('\n')[4]}`);
                }
                else {
                    console[level](`${line} ${(_b = err.stack) === null || _b === void 0 ? void 0 : _b.split('\n')[8]}`);
                }
            }
        }
    }
}
export class LoggerUtil {
    constructor(levelSetting, formatter, transport) {
        this.levelSetting = levelSetting;
        this.formatter = formatter;
        this.transport = transport;
    }
    log(level, data) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSetting)) {
            this.transport.send(level, this.formatter.format({ level, data, timestamp: new Date() }));
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
        return new LoggerUtil(level, new ConsoleLogFormatter('browser'), new ConsoleLogTransport('browser'));
    }
    static nodeConsole(level) {
        return new LoggerUtil(level, new ConsoleLogFormatter('nodejs'), new ConsoleLogTransport('nodejs'));
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