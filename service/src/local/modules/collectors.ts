import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { DelimitedData, FluidityPacket } from '#@shared/types.js';

type SerialParser = ReadlineParser | RegexParser;

interface Destination {
    location: string;
    key?: string;
}

type DataCollectorParams = Omit<FluidityPacket, 'data'> & {
    destinations: Destination[];
};

interface SerialPortParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {}

    abstract listen(): void;

    send(data: DelimitedData[]) {
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
        this.parser.on('data', data => {
            this.send([{ display: 1, field: data }]);
        });
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
