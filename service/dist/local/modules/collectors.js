import { SerialPort, ReadlineParser } from 'serialport';
class DataCollector {
    params;
    constructor(params) {
        this.params = params;
    }
    send(data) {
        console.log(data);
    }
}
class SerialCollector extends DataCollector {
    port;
    parser;
    constructor({ path, baudRate, ...params }) {
        super(params);
        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
        this.parser.on('data', this.send);
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
