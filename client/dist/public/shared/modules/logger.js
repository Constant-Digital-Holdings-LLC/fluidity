var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["trace"] = 0] = "trace";
    LogLevel[LogLevel["debug"] = 1] = "debug";
    LogLevel[LogLevel["info"] = 2] = "info";
    LogLevel[LogLevel["warn"] = 3] = "warn";
    LogLevel[LogLevel["error"] = 4] = "error";
    LogLevel[LogLevel["critical"] = 5] = "critical";
    LogLevel[LogLevel["none"] = 6] = "none";
})(LogLevel || (LogLevel = {}));
export class Logger {
    constructor(formatter, transport) {
        this.formatter = formatter;
        this.transport = transport;
    }
}
export function test() {
    console.log('v 9');
}
//# sourceMappingURL=logger.js.map