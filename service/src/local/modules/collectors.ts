import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { DelimitedData, FluidityPacket, PublishTarget } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

interface DataCollectorParams extends Omit<FluidityPacket, 'delimData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    options?: unknown;
}

type SerialParser = ReadlineParser | RegexParser;

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
    constructor(public params: DataCollectorParams) {
        //need to make sure the props I care about are here
    }

    abstract listen(): void;

    protected format(data: string): DelimitedData[] {
        return [{ display: 1, field: data }];
    }

    private addTS(delimData: DelimitedData[]): DelimitedData[] {
        return delimData;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        log.debug(fPacket);
    }

    send(data: string) {
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
