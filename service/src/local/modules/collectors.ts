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

interface SRSPortMap {
    [key: number]: string | undefined;
}

const isSRSportMap = (obj: unknown): obj is SRSPortMap => {
    return Array.isArray(obj) && typeof obj[0] === 'string';
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
        const portMatrix: StateData = [[], [], [], [], [], [], [], []];

        decodeList.forEach((dc, decodeIndex) => {
            const binText: string[] = [];
            let num = parseInt(dc, radix);
            const prefix = radix === 16 ? '0x' : '';

            if (num) {
                log.info(
                    `Decoding:\t${prefix + dc.toUpperCase()} (${
                        stateType === 'PORT' ? portStates[decodeIndex] : radioStates[decodeIndex]
                    }) of ${decodeList.map(v => prefix + v.toUpperCase())}\t`
                );

                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
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
                    } else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }

                log.info(`Decoded:\t${JSON.stringify(binText)}\t`);
            }
        });

        return portMatrix;
    }

    override format(data: string): ProcessedData[] | null {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);
        let stateData: StateData = [[]];

        const pLookup = (p: number): string => {
            let portName: string | undefined;
            const eo = this.params.extendedOptions;

            if (eo && typeof eo === 'object' && 'portmap' in eo) {
                const { portmap } = eo;
                if (isSRSportMap(portmap)) {
                    portName = portmap[p];
                }
            }

            return portName ? `port-${p} [${portName}]` : `port-${p}`;
        };

        if (typeof result?.[1] === 'string' && (data[0] === '[' || data[0] === '{')) {
            if (data[0] === '[') {
                stateData = this.decode('RADIO', 16, result[1].split(' '));
            }

            if (data[0] === '{') {
                stateData = this.decode('PORT', 16, result[1].split(' '));
            }
        } else {
            return null;
        }

        stateData.forEach((s, index) => {
            if (s.length) log.info(`${pLookup(index)}: ${s}\t`);
        });

        return [{ display: 1, field: data }];
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
