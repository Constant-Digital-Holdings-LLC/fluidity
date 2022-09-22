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
        if (this.runtime === 'browser') {
            console[level].call(window.console, line);
        }
        else {
            console[level].call(global.console, line);
        }
    }
}
export class LoggerUtil {
    constructor(level, formatter, transport) {
        this.level = level;
        this.formatter = formatter;
        this.transport = transport;
    }
    log(level, data) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.level)) {
            this.transport.send(this.level, this.formatter.format({ level, data, timestamp: new Date() }));
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