import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
const log = fetchLogger();
class DataCollector {
    params;
    constructor(params) {
        this.params = params;
    }
    format(data) {
        return [{ display: 1, field: data }];
    }
    addTS(formattedData) {
        return formattedData;
    }
    sendHttps(data) {
        log.info(data);
    }
    send(data) {
        const { site, label, collectorType, destinations } = this.params;
        const formattedData = this.params.omitTS ? this.format(data) : this.addTS(this.format(data));
        destinations.forEach(d => {
            if (new URL(d.location).protocol === 'https:') {
                log.debug(`location: ${d.location}, `);
                this.sendHttps({ site, label, collectorType, data: formattedData });
            }
        });
    }
}
class SerialCollector extends DataCollector {
    port;
    parser;
    constructor({ path, baudRate, ...params }) {
        super(params);
        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }
    listen() {
        this.parser.on('data', this.send.bind(this));
    }
}
export class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\n' });
    }
}
export class SRS1serialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    format(data) {
        return [{ display: 99, field: data }];
    }
    fetchParser() {
        return new RegexParser({ regex: /(?:>*[\r\n]|Reply: <(?::ok)?)/g });
    }
}
