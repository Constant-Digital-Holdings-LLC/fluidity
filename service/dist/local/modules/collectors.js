import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
const conf = await config();
const log = fetchLogger(conf);
const isSRSOptions = (obj) => {
    return Array.isArray(obj?.portmap);
};
class DataCollector {
    params;
    constructor(params) {
        this.params = params;
    }
    format(data) {
        return [{ display: 1, field: data }];
    }
    addTS(delimData) {
        return delimData;
    }
    sendHttps(fPacket) {
        log.debug(fPacket);
    }
    send(data) {
        const { site, label, collectorType, targets } = this.params;
        const delimData = this.params.omitTS ? this.format(data) : this.addTS(this.format(data));
        targets.forEach(t => {
            if (new URL(t.location).protocol === 'https:') {
                log.debug(`location: ${t.location}, `);
                this.sendHttps({ site, label, collectorType, delimData: delimData });
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
export class SRSserialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    format(data) {
        if (isSRSOptions(this.params.options)) {
            const { portmap } = this.params.options;
        }
        return [{ display: 99, field: data }];
    }
    fetchParser() {
        return new RegexParser({ regex: /(?:>*[\r\n]|Reply: <(?::ok)?)/g });
    }
}
