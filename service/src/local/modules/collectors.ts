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
        (['targets', 'site', 'label', 'collectorType'] as const).forEach(p => {
            if (!params?.[p]) {
                throw new Error(`DataCollector constructor - required param: [${p}] missing or undefined`);
            }
        });
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

        try {
            targets.forEach(t => {
                if (new URL(t.location).protocol === 'https:') {
                    log.debug(`location: ${t.location}, `);

                    this.sendHttps({ site, label, collectorType, delimData: delimData });
                } else {
                    throw new Error(`unsupported protocol in target location: ${t.location}`);
                }
            });
        } catch (err) {
            log.error(err);
        }
    }
}

abstract class SerialCollector extends DataCollector {
    port: SerialPort;
    parser: SerialParser;

    abstract fetchParser(): SerialParser;

    constructor({ path, baudRate, ...params }: SerialPortParams) {
        super(params);

        if (!path) throw new Error(`missing serial port identifier for ${params.collectorType}: ${params.label}`);
        if (!baudRate) throw new Error(`port speed for ${params.collectorType}: ${params.label}`);

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
