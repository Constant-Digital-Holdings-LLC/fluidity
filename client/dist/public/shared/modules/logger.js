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
            let location = '';
            try {
                throw Error('');
            }
            catch (err) {
                if (err instanceof Error) {
                    if (this.runtime === 'browser') {
                    }
                    else {
                    }
                }
            }
            this.transport.send(level, this.formatter.format({ level, data, timestamp: new Date(), location }));
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