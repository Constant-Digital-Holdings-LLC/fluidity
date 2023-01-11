import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { ProcessedData, FluidityPacket, PublishTarget } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';
import { type } from 'os';

const conf = await config();
const log = fetchLogger(conf);

interface DataCollectorParams extends Omit<FluidityPacket, 'delimData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    keepRaw: boolean;
    extendedOptions?: unknown;
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
        (['targets', 'site', 'label', 'collectorType', 'keepRaw'] as const).forEach(p => {
            if (typeof params?.[p] === 'undefined') {
                throw new Error(`DataCollector constructor - required param: [${p}] undefined`);
            }
        });
    }

    abstract listen(): void;

    protected format(data: string): ProcessedData[] {
        return [{ display: 1, field: data }];
    }

    private addTS(delimData: ProcessedData[]): ProcessedData[] {
        return delimData;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        // log.debug(fPacket);
    }

    send(data: string) {
        const { site, label, collectorType, targets, keepRaw } = this.params;
        const processedData = this.params.omitTS ? this.format(data) : this.addTS(this.format(data));

        try {
            targets.forEach(t => {
                if (new URL(t.location).protocol === 'https:') {
                    // log.debug(`location: ${t.location}, `);

                    this.sendHttps({
                        site,
                        label,
                        collectorType,
                        processedData: processedData,
                        rawData: keepRaw ? data : null
                    });
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

const radioStatesArr = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT ON'] as const;
const portStatesArr = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT GROUP', 'INTERFACED'] as const;

type SRSRadioState = typeof radioStatesArr[number];
type SRSPortState = typeof portStatesArr[number];
type SRSstate = SRSRadioState & SRSPortState;

enum RadioStates {
    'COR',
    'PL',
    'RCVACT',
    'DTMF',
    'XMIT ON'
}

enum PortStates {
    'LINK',
    'LOOPBACK',
    'DISABLED',
    'SUDISABLED',
    'SPLIT GROUP',
    'INTERFACED'
}

export class SRSserialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    private decode(
        stateType: 'port' | 'radio',
        radix: number,
        elements: number[]
    ): (Array<keyof typeof RadioStates> | Array<keyof typeof PortStates>)[] {
        return [['INTERFACED', 'LINK']];
    }

    private portsInState(val: number): boolean[] {
        const boolArr: boolean[] = [];

        for (let bit = 0; bit < 8; bit++) {
            boolArr.push((val & 1) === 1);
            val >>= 1;
        }

        return boolArr;
    }

    override format(data: string): ProcessedData[] {
        if (isSRSOptions(this.params.extendedOptions)) {
            const { portmap } = this.params.extendedOptions;
        }

        log.debug(data);

        console.log(this.portsInState(91));

        return [{ display: 99, field: data }];
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
