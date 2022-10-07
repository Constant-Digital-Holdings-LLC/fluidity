const levelsArr = ['debug', 'info', 'warn', 'error'];
class SimpleFormatter {
    constructor(runtime) {
        this.runtime = runtime;
    }
    format(data) {
        var _a, _b;
        const { message, timestamp, level } = data;
        let formattedMesg;
        if (typeof message !== 'string') {
            formattedMesg = JSON.stringify(message);
        }
        else {
            formattedMesg = message;
        }
        if (((_a = data.location) === null || _a === void 0 ? void 0 : _a.file) && ((_b = data.location) === null || _b === void 0 ? void 0 : _b.line)) {
            const { location: { file, line } } = data;
            return `[${timestamp.toISOString().slice(11, -1)}]: ${formattedMesg} (${file}:${line})`;
        }
        else {
            return `[${timestamp.toISOString().slice(11, -1)}]: ${formattedMesg}`;
        }
    }
}
class NodeConsoleFormatter extends SimpleFormatter {
    format(data) {
        const map = [94, 97, 33, 91];
        return `\x1b[${map[levelsArr.indexOf(data.level)]}m${super.format(data)}\x1b[0m`;
    }
}
class JSONFormatter {
    constructor(runtime) {
        this.runtime = runtime;
    }
    format(data) {
        return JSON.stringify(data);
    }
}
class ConsoleTransport {
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
                    throw new Error('get logger.ts telemetry');
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
        const runtime = 'browser';
        return new LoggerUtil(levelSettings, new SimpleFormatter(runtime), new ConsoleTransport(runtime), runtime);
    }
    static nodeConsole(levelSettings) {
        const runtime = 'nodejs';
        return new LoggerUtil(levelSettings, new NodeConsoleFormatter(runtime), new ConsoleTransport(runtime), runtime);
    }
    static EmitJSON(levelSettings) {
        const runtime = 'nodejs';
        return new LoggerUtil(levelSettings, new JSONFormatter(runtime), new ConsoleTransport(runtime), runtime);
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