import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { DelimitedData, FluidityPacket } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';

const log = fetchLogger();

type SerialParser = ReadlineParser | RegexParser;

interface Destination {
    location: string;
    key?: string;
}

type DataCollectorParams = Omit<FluidityPacket, 'delimData'> & {
    destinations: Destination[];
    omitTS?: boolean;
    options?: unknown;
};

interface SerialPortParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

interface SRSOptions {
    portmap: string[];
}

const isSRSOptions = (obj: unknown): obj is SRSOptions => {
    return Array.isArray((obj as SRSOptions)?.portmap);
};

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {}

    abstract listen(): void;

    protected format(data: string): DelimitedData[] {
        return [{ display: 1, field: data }];
    }

    private addTS(delimData: DelimitedData[]): DelimitedData[] {
        return delimData;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        log.info(fPacket);
    }

    send(data: string) {
        const { site, label, collectorType, destinations } = this.params;
        const delimData = this.params.omitTS ? this.format(data) : this.addTS(this.format(data));

        destinations.forEach(d => {
            if (new URL(d.location).protocol === 'https:') {
                log.debug(`location: ${d.location}, `);

                this.sendHttps({ site, label, collectorType, delimData: delimData });
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

export class SRSserialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    override format(data: string): DelimitedData[] {
        if (isSRSOptions(this.params.options)) {
            const { portmap } = this.params.options;
        }

        return [{ display: 99, field: data }];
    }

    fetchParser(): RegexParser {
        return new RegexParser({ regex: /(?:>*[\r\n]|Reply: <(?::ok)?)/g });
    }
}
