import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { DelimitedData, FluidityPacket } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';

const log = fetchLogger();

type SerialParser = ReadlineParser | RegexParser;

interface Destination {
    location: string;
    key?: string;
}

type DataCollectorParams = Omit<FluidityPacket, 'data'> & {
    destinations: Destination[];
    omitTS?: boolean;
};

interface SerialPortParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {}

    abstract listen(): void;

    protected format(data: string): DelimitedData[] {
        return [{ display: 1, field: data }];
    }

    private addTS(formattedData: DelimitedData[]): DelimitedData[] {
        return formattedData;
    }

    private sendHttps(data: FluidityPacket): void {
        log.info(data);
    }

    send(data: string) {
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
        this.parser.on('data', this.send.bind(this));
    }
}

export class GenericSerialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\n' });
    }
}

export class SRS1serialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    override format(data: string): DelimitedData[] {
        return [{ display: 99, field: data }];
    }

    fetchParser(): RegexParser {
        return new RegexParser({ regex: /(?:>*[\r\n]|Reply: <(?::ok)?)/g });
    }
}
