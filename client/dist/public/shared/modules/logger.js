var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { inBrowser } from '#@shared/modules/utils.js';
export const levelsArr = ['debug', 'info', 'warn', 'error', 'never'];
class FormatterBase {
    constructor(levelSettings) {
        this.levelSettings = levelSettings;
    }
    format(data) {
        var _a, _b;
        const { message, timestamp, level } = data;
        let formattedMesg = '';
        if (typeof message === 'string') {
            formattedMesg = message;
        }
        else if (level === 'debug' || this.levelSettings.logLevel === 'debug') {
            formattedMesg = JSON.stringify(message, undefined, '\t');
        }
        else {
            formattedMesg = JSON.stringify(message);
        }
        if (message instanceof Error) {
            formattedMesg += `\nstack-->\n${message.stack} <--stack`;
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
        const { message: m } = data, rest = __rest(data, ["message"]);
        if (typeof m === 'string') {
            const message = m.replace(/[\t\n]/g, ' ');
            return JSON.stringify(Object.assign({ message }, rest));
        }
        return JSON.stringify(data);
    }
}
class ConsoleTransport {
    send(level, line) {
        if (level !== 'never')
            console[level](line);
    }
}
export class LoggerUtil {
    constructor(levelSettings, formatter, transport, runtime) {
        this.levelSettings = levelSettings;
        this.formatter = formatter;
        this.transport = transport;
        this.runtime = runtime;
        Boolean(levelSettings.locLevel) &&
            levelSettings.locLevel !== 'never' &&
            this.log('warn', 'Performance degraded due to location tracing\n');
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
        if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.logLevel || 'debug')) {
            const snd = (location) => {
                this.transport.send(level, this.formatter.format({
                    level,
                    message,
                    timestamp: new Date(),
                    location
                }));
            };
            if (levelsArr.indexOf(level) >= levelsArr.indexOf(this.levelSettings.locLevel || 'never')) {
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
    never(data) { }
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
export const httpLogger = (log) => {
    let requests = 0;
    let timeSum = 0;
    const getDurationInMilliseconds = (start) => {
        const NS_PER_SEC = 1e9;
        const NS_TO_MS = 1e6;
        const diff = process.hrtime(start);
        return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
    };
    return (req, res, next) => {
        const start = process.hrtime();
        res.on('finish', () => {
            const durationInMilliseconds = getDurationInMilliseconds(start);
            requests++;
            timeSum += durationInMilliseconds;
            const averageReqTime = timeSum / requests;
            const logMesg = `${req.method} ${req.url}\t[${res.statusCode}]\t${durationInMilliseconds.toLocaleString()} ms`;
            if (res.statusCode >= 500 && res.statusCode <= 599) {
                log.error(logMesg);
            }
            else if (durationInMilliseconds > averageReqTime * 3) {
                log.warn(logMesg);
            }
            else {
                log.info(logMesg);
            }
        });
        next();
    };
};
const foo = console;
export const fetchLogger = (conf) => {
    const { logLevel, locLevel, logFormat } = conf || {};
    if (inBrowser()) {
        return LoggerUtil.browserConsole({ logLevel, locLevel });
    }
    else {
        if (levelsArr.indexOf(logLevel || 'debug') >= levelsArr.indexOf('info') && logFormat === 'JSON') {
            return LoggerUtil.JSONEmitter({ logLevel, locLevel });
        }
        else {
            return LoggerUtil.nodeConsole({ logLevel, locLevel });
        }
    }
};
//# sourceMappingURL=logger.js.map