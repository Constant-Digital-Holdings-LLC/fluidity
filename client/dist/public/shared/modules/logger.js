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
export class Logger {
    constructor(level, formatter, transport) {
        this.level = level;
        this.formatter = formatter;
        this.transport = transport;
    }
    log(data) {
        if (levelsArr.indexOf(data.level) >= levelsArr.indexOf(this.level)) {
            this.transport.send(this.level, this.formatter.format(data));
        }
    }
    info(data) {
        this.log({ level: 'info', message: data, timestamp: new Date() });
    }
    static browserConsole(level) {
        return new Logger(level, new ConsoleLogFormatter('browser'), new ConsoleLogTransport('browser'));
    }
    static nodeConsole(level) {
        return new Logger(level, new ConsoleLogFormatter('nodejs'), new ConsoleLogTransport('nodejs'));
    }
}
export let logger;
if (typeof window === 'undefined' && typeof process === 'object') {
    logger = Logger.nodeConsole('debug');
}
else {
    logger = Logger.browserConsole('debug');
}
//# sourceMappingURL=logger.js.map