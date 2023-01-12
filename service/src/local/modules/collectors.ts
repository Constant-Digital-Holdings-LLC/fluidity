import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { ProcessedData, FluidityPacket, PublishTarget } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

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

    protected format(data: string): ProcessedData[] | null {
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

        let processedData = this.format(data);

        if (processedData) {
            !this.params.omitTS && (processedData = this.addTS(processedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        // log.debug(`location: ${t.location}, `);

                        if (processedData) {
                            this.sendHttps({
                                site,
                                label,
                                collectorType,
                                processedData: processedData,
                                rawData: keepRaw ? data : null
                            });
                        }
                    } else {
                        throw new Error(`unsupported protocol in target location: ${t.location}`);
                    }
                });
            } catch (err) {
                log.error(err);
            }
        } else {
            log.debug(`DataCollector: ignoring unkown string: ${data}`);
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

const radioStates = ['COR', 'PL', 'RCVACT', 'DTMF', 'XMIT_ON'] as const;
const portStates = ['LINK', 'LOOPBACK', 'DISABLED', 'SUDISABLED', 'SPLIT_GROUP', 'INTERFACED'] as const;

type RadioStateData = Array<typeof radioStates[number]>[];
type PortStateData = Array<typeof portStates[number]>[];
type StateData = RadioStateData | PortStateData;

export class SRSserialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    private decode(stateType: 'RADIO' | 'PORT', radix: number, decodeList: string[]): StateData {
        let portMatrix: StateData = [[], [], [], [], [], [], [], [], []];

        decodeList.forEach((dc, decodeIndex) => {
            let num = parseInt(dc, radix);

            for (let bit = 0; bit < 8; bit++) {
                if ((num & 1) === 1) {
                    if (stateType === 'RADIO') {
                        (portMatrix[bit] as Array<typeof radioStates[number] | undefined>)?.push(
                            radioStates[decodeIndex]
                        );
                    }
                    if (stateType === 'PORT') {
                        (portMatrix[bit] as Array<typeof portStates[number] | undefined>)?.push(
                            portStates[decodeIndex]
                        );
                    }
                }
                num >>= 1;
            }
        });

        return portMatrix;
    }

    private portsInState(val: number): boolean[] {
        const boolArr: boolean[] = [];

        for (let bit = 0; bit < 8; bit++) {
            boolArr.push((val & 1) === 1);
            val >>= 1;
        }

        return boolArr;
    }

    override format(data: string): ProcessedData[] | null {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);

        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            let stateData: StateData = [[]];

            if (data[0] === '[') {
                stateData = this.decode('RADIO', 16, result[1].split(' '));
                log.info(`Orig: ${data}`);
                log.debug('Radio States:');
                log.debug(`port 0 ${stateData[0]}`);
                log.debug(`port 1 ${stateData[1]}`);
                log.debug(`port 2 ${stateData[2]}`);
                log.debug(`port 3 ${stateData[3]}`);
                log.debug(`port 4 ${stateData[4]}`);
                log.debug(`port 5 ${stateData[5]}`);
                log.debug(`port 6 ${stateData[6]}`);
                log.debug(`port 7 ${stateData[7]}`);
            }

            if (data[0] === '{') {
                stateData = this.decode('PORT', 16, result[1].split(' '));
                log.info(`Orig: ${data}`);
                log.debug('Port States:');
                log.debug(`port 0 ${stateData[0]}`);
                log.debug(`port 1 ${stateData[1]}`);
                log.debug(`port 2 ${stateData[2]}`);
                log.debug(`port 3 ${stateData[3]}`);
                log.debug(`port 4 ${stateData[4]}`);
                log.debug(`port 5 ${stateData[5]}`);
                log.debug(`port 6 ${stateData[6]}`);
                log.debug(`port 7 ${stateData[7]}`);
            }

            if (isSRSOptions(this.params.extendedOptions)) {
                const { portmap } = this.params.extendedOptions;
            }
        } else {
            return null;
        }

        return [{ display: 99, field: data }];
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
