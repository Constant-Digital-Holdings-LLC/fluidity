import { SerialPort, ReadlineParser, RegexParser } from 'serialport';

type SerialParser = ReadlineParser | RegexParser;

interface DataCollectorParams {
    site: string;
    label: string;
    type: 'generic-serial' | 'srs1';
}

interface SerialPortParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

class DataCollector {
    constructor(public params: DataCollectorParams) {}
    send(data: any) {
        console.log(data);
    }
}

abstract class SerialCollector extends DataCollector {
    port: SerialPort;
    parser: SerialParser;

    abstract fetchParser(): SerialParser;

    constructor(public override params: SerialPortParams) {
        super(params);

        const { path, baudRate } = params;

        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
        this.parser.on('data', this.send);
    }
}

export class GenericSerialCollector extends SerialCollector {
    constructor(public override params: SerialPortParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
