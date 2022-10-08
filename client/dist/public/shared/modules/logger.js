const levelsArr = ['debug', 'info', 'warn', 'error'];
class FormatterBase {
    constructor(levelSettings) {
        this.levelSettings = levelSettings;
    }
    format(data) {
        var _a, _b;
        const { message, timestamp, level } = data;
        let formattedMesg;
        if (typeof message !== 'string') {
            if (level === 'debug' || this.levelSettings.logLevel === 'debug') {
                formattedMesg = JSON.stringify(message, undefined, '\t');
            }
            else {
                formattedMesg = JSON.stringify(message);
            }
        }
        else {
            formattedMesg = message;
        }
        if (((_a = data.location) === null || _a === void 0 ? void 0 : _a.file) && ((_b = data.location) === null || _b === void 0 ? void 0 : _b.line)) {
            const { location: { file, line } } = data;
            return `[${this.dateString(timestamp)}]: ${formattedMesg} (${file}:${line})`;
        }
        else {
            return `[${this.dateString(timestamp)}]: ${formattedMesg}`;
        }
    }
}
class SimpleConsoleFormatter extends FormatterBase {
    dateString(date) {
        if (this.levelSettings.logLevel === 'debug') {
            return date.toISOString().slice(11, -1);
        }
        else {
            return date.toISOString();
        }
    }
}
class BrowserConsoleFormatter extends FormatterBase {
    dateString(date) {
        return date.toISOString().slice(11, -1);
    }
}
class NodeConsoleFormatter extends SimpleConsoleFormatter {
    format(data) {
        const colorLevels = [94, 97, 33, 91];
        return super
            .format(data)
            .split(/\r?\n/)
            .map(l => `\x1b[${colorLevels[levelsArr.indexOf(data.level)]}m${l}\x1b[0m`)
            .join('\n');
    }
}
class JSONFormatter {
    constructor(levelSettings) {
        this.levelSettings = levelSettings;
    }
    format(data) {
        return JSON.stringify(data);
    }
}
class ConsoleTransport {
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
                    throw new Error('generate stack');
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
    log(level, message) {
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel)) {
            const snd = (location) => {
                this.transport.send(level, this.formatter.format({
                    level,
                    message,
                    timestamp: new Date(),
                    location
                }));
            };
            if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.locLevel)) {
                this.getStackLocation().then(snd);
            }
            else {
                snd();
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
        return new LoggerUtil(levelSettings, new BrowserConsoleFormatter(levelSettings), new ConsoleTransport(), 'browser');
    }
    static nodeConsole(levelSettings) {
        return new LoggerUtil(levelSettings, new NodeConsoleFormatter(levelSettings), new ConsoleTransport(), 'nodejs');
    }
    static JSONEmitter(levelSettings) {
        return new LoggerUtil(levelSettings, new JSONFormatter(levelSettings), new ConsoleTransport(), 'nodejs');
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