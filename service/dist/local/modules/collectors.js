import { SerialPort, ReadlineParser } from 'serialport';
import { fetchLogger } from '#@shared/modules/logger.js';
const log = fetchLogger();
class DataCollector {
    params;
    constructor(params) {
        this.params = params;
    }
    sendHttps(data) {
        log.info(data);
    }
    send(data) {
        this.params.destinations.forEach(d => {
            if (new URL(d.location).protocol === 'https:') {
                log.debug(`location: ${d.location}, `);
                this.sendHttps(data);
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
        this.parser.on('data', data => {
            this.send([{ display: 1, field: data }]);
        });
    }
}
export class GenericSerialCollector extends SerialCollector {
    constructor(params) {
        super(params);
    }
    fetchParser() {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
