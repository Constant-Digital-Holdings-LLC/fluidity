import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { FormattedData, FluidityPacket, PublishTarget, FluidityField } from '#@shared/types.js';
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

class LineFormatHelper {
    private formattedData: FormattedData[];

    constructor() {
        this.formattedData = [];
    }

    e(element: FluidityField | StringAble, suggestStyle?: number): this {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'STRING' });
        } else if (element instanceof Object && 'location' in element && 'name' in element) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'LINK' });
        } else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'DATE' });
        } else {
            this.formattedData.push({ suggestStyle, field: element.toString(), fieldType: 'STRING' });
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
        return new LineFormatHelper().e(data).done;
    }

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        log.debug(fPacket);
    }

    send(data: string) {
        const { site, label, collectorType, targets, keepRaw } = this.params;

        let formattedData = this.format(data);

        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        log.debug(`location: ${t.location}, `);

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

export class SRSserialCollector extends SerialCollector {
    constructor(params: SerialPortParams) {
        super(params);
    }

    private decode<T extends RadioStates | PortStates>(
        stateList: readonly string[],
        radix: number,
        decodeList: string[]
    ): T[][] {
        const portMatrix: T[][] = [[], [], [], [], [], [], [], []];

        decodeList.forEach((dc, decodeIndex) => {
            const binText: string[] = [];
            let num = parseInt(dc, radix);
            const prefix = radix === 16 ? '0x' : '';

            if (num) {
                log.debug('\n\n');
                log.debug(
                    `Decoding:\t${prefix + dc.toUpperCase()} (${stateList[decodeIndex]}) of ${decodeList.map(
                        v => prefix + v.toUpperCase()
                    )}\t`
                );

                for (let bit = 0; bit < 8 && num; bit++) {
                    if ((num & 1) === 1) {
                        binText.unshift('1');
                        if (typeof stateList[decodeIndex] === 'string') {
                            portMatrix[bit]?.push(stateList[decodeIndex] as T);
                        }
                    } else {
                        binText.unshift('0');
                    }
                    num >>= 1;
                }

                log.debug(`Decoded:\t${binText.toString()}\t\t`);
            }
        });

        return portMatrix;
    }

    override format(data: string): FormattedData[] | null {
        const result = data.match(/[[{]((?:[a-fA-F0-9]{2}\s*)+)[\]}]/);

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
                //prettier-ignore
                return [
                    ...new LineFormatHelper()
                        .e('RADIO States->', 0)
                        .done,
                    ...this.decode<RadioStates>(radioStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? new LineFormatHelper()
                            .e(`${pLookup(index)}:`, 0)
                            .e(s, 21)
                            .done : []
                    )
                ];
            }
            if (data[0] === '{') {
                //prettier-ignore
                return [
                    ...new LineFormatHelper()
                        .e('PORT States->', 0)
                        .done,
                    ...this.decode<PortStates>(portStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? new LineFormatHelper()
                            .e(`${pLookup(index)}:`, 0)
                            .e(s, 22)
                            .done : []
                    )
                ];
            }
        }
        return null;
    }

    fetchParser(): ReadlineParser {
        return new ReadlineParser({ delimiter: '\r\n' });
    }
}
