import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { FormattedData, FluidityPacket, PublishTarget, FluidityLink, FluidityField } from '#@shared/types.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { config } from '#@shared/modules/config.js';

const conf = await config();
const log = fetchLogger(conf);

type SerialParser = ReadlineParser | RegexParser;
type StringAble = {
    toString(): string;
};

interface DataCollectorParams extends Omit<FluidityPacket, 'delimData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    keepRaw: boolean;
    extendedOptions?: unknown;
}

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

class FormatUtility {
    private formattedData: FormattedData[] = [];

    e(element: FluidityField | StringAble, suggestStyle?: number): this {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'string' });
        } else if (element instanceof Object && 'location' in element && 'name' in element) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'link' });
        } else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'date' });
        } else {
            this.formattedData.push({ suggestStyle, field: element.toString(), fieldType: 'string' });
        }

        return this;
    }

    public get done(): FormattedData[] {
        return this.formattedData;
    }
}

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {
        (['targets', 'site', 'label', 'collectorType', 'keepRaw'] as const).forEach(p => {
            if (typeof params?.[p] === 'undefined') {
                throw new Error(`DataCollector constructor - required param: [${p}] undefined`);
            }
        });
    }

    abstract listen(): void;

    protected format(data: string): FormattedData[] | null {
        return [{ suggestStyle: 1, field: data, fieldType: 'string' }];
    }

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        // log.debug(fPacket);
    }

    send(data: string) {
        const { site, label, collectorType, targets, keepRaw } = this.params;

        let formattedData = this.format(data);

        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        // log.debug(`location: ${t.location}, `);

                        if (formattedData) {
                            this.sendHttps({
                                site,
                                label,
                                collectorType,
                                formattedData: formattedData,
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
type RadioStates = typeof radioStates[number];
type PortStates = typeof portStates[number];
type RadioStateData = RadioStates[][];
type PortStateData = PortStates[][];

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
                log.info('\n\n');
                log.info(
                    `Decoding:\t${prefix + dc.toUpperCase()} (${
                        stateType === 'PORT' ? portStates[decodeIndex] : radioStates[decodeIndex]
                    }) of ${decodeList.map(v => prefix + v.toUpperCase())}\t`
                );

                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
                        if (stateType === 'RADIO' && radioStates[decodeIndex]) {
                            (portMatrix[bit] as Array<RadioStates>).push(radioStates[decodeIndex]!);
                        }
                        if (stateType === 'PORT' && portStates[decodeIndex]) {
                            (portMatrix[bit] as Array<PortStates>).push(portStates[decodeIndex]!);
                        }
                    } else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }

                log.info(`Decoded:\t${binText.toString()}\t\t`);
            }
        });

        return portMatrix;
    }

    override format(data: string): FormattedData[] | null {
        const f = new FormatUtility();
        log.info(
            f
                .e('I went ')
                .e('online', 1)
                .e(' and searched ')
                .e(5, 1)
                .e(' times on ')
                .e({ location: 'http://google.com', name: 'Google' })
                .e('at ')
                .e(new Date())
                .e('!').done
        );

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
            if (s.length) log.info(`${pLookup(index)}:\t${s}\t`);
        });

        return [{ suggestStyle: 1, field: data, fieldType: 'string' }];
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
