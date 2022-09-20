export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["debug"] = 0] = "debug";
    LogLevel[LogLevel["info"] = 1] = "info";
    LogLevel[LogLevel["warn"] = 2] = "warn";
    LogLevel[LogLevel["error"] = 3] = "error";
    LogLevel[LogLevel["none"] = 4] = "none";
})(LogLevel = LogLevel || (LogLevel = {}));
export class ConsoleLogFormatter {
    constructor(runtime) {
        this.runtime = runtime;
    }
}
export class Logger {
    constructor(loglevel, formatter, transport) {
        this.loglevel = loglevel;
        this.formatter = formatter;
        this.transport = transport;
    }
}
export function test() {
    console.log('v 9');
}
//# sourceMappingURL=logger.js.map