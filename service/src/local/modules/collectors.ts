import { SerialPort, ReadlineParser, RegexParser } from 'serialport';

type SerialParser = ReadlineParser | RegexParser;

interface Destination {
    location: string;
    key?: string;
}

interface DataCollectorParams {
    site: string;
    destinations: Destination[];
    label: string;
    type: 'generic-serial' | 'srs1';
}

interface SerialPortParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {}

    abstract listen(): void;

    send(data: any) {
        console.log(data);
    }
}

abstract class SerialCollector extends DataCollector {
    port: SerialPort;
    parser: SerialParser;

    abstract fetchParser(): SerialParser;

    constructor({ path, baudRate, ...params }: SerialPortParams) {
        super(params);

        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }

    listen(): void {
        this.parser.on('data', this.send);
    }
}

export class GenericSerialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
