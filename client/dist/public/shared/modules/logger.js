const levelsArr = ['debug', 'info', 'warn', 'error'];
class ConsoleLogFormatter {
    constructor(runtime) {
        this.runtime = runtime;
    }
    format(data) {
        return `${data} foo`;
    }
}
class ConsoleLogTransport {
    send(level, line) {
        console[level].bind(global.console, line);
    }
}
export class Logger {
    constructor(level, formatter, transport) {
        this.level = level;
        this.formatter = formatter;
        this.transport = transport;
    }
    shoudLog(level) {
        return levelsArr.indexOf(level) >= levelsArr.indexOf(this.level);
    }
}
export default new Logger('debug', new ConsoleLogFormatter('nodejs'), new ConsoleLogTransport());
export function test() {
    console.log('v 9');
}
//# sourceMappingURL=logger.js.map