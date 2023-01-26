import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import { setIntervalAsync, clearIntervalAsync } from 'set-interval-async';
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
    keepRaw?: boolean;
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

class FormatHelper {
    private formattedData: FormattedData[] = [];

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

    get done(): FormattedData[] {
        const clone: FormattedData[] = JSON.parse(JSON.stringify(this.formattedData));
        this.formattedData.length = 0;
        return clone;
    }
}

abstract class DataCollector {
    constructor(public params: DataCollectorParams) {
        const { targets, site, label, collectorType, keepRaw, omitTS } = params || {};

        // for ${params.collectorType}: ${params.label}

        if (!Array.isArray(targets)) {
            throw new Error(`DataCollector constructor - expected array of targets[] in config`);
        }
        if (typeof site !== 'string') {
            throw new Error(`DataCollector constructor - site name in config`);
        }
        if (typeof label !== 'string') {
            throw new Error(`DataCollector constructor - collector of type ${collectorType} missing label in config`);
        }
        if (typeof collectorType !== 'string') {
            throw new Error(`DataCollector constructor - collector ${label} requires a collectorType field in config`);
        }
        if (typeof keepRaw !== 'undefined' && typeof keepRaw !== 'boolean') {
            throw new Error(
                `DataCollector constructor - optional keepRaw field should be a boolean for collector: ${label}`
            );
        }
        if (typeof omitTS !== 'undefined' && typeof omitTS !== 'boolean') {
            throw new Error(
                `DataCollector constructor - optional omitTS field should be a boolean for collector ${label}`
            );
        }
    }

    abstract start(): void;

    protected format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(fPacket: FluidityPacket): void {
        log.debug('############### BEGIN ONE HTTP POST ###############');
        log.debug(fPacket);
        log.debug('############### END ONE HTTP POST   ###############');
    }

    send(data: string) {
        const { site, label, collectorType, targets, keepRaw } = this.params;

        let formattedData = this.format(data, new FormatHelper());

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

abstract class NetAnnounce extends DataCollector {
    private pollIntervalMin: number;
    private announceEveryMin: number;

    constructor(params: { pollIntervalMin: number; announceEveryMin: number } & DataCollectorParams) {
        super(params);

        if (typeof params.pollIntervalMin === 'number' && typeof params.announceEveryMin === 'number') {
            ({ pollIntervalMin: this.pollIntervalMin, announceEveryMin: this.announceEveryMin } = params);
        } else {
            throw new Error(
                `expected numeric values pollIntervalMin and announceEveryMin for ${params.collectorType}: ${params.label}`
            );
        }
    }

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    start(): void {
        //use setIntervalAsync (imported) here. Have it call this.send()
    }
}

abstract class SerialCollector extends DataCollector {
    port: SerialPort;
    parser: SerialParser;

    abstract fetchParser(): SerialParser;

    constructor({ path, baudRate, ...params }: SerialPortParams) {
        super(params);

        if (typeof path !== 'string')
            throw new Error(
                `expected serial port identifier (string) in config for ${params.collectorType}: ${params.label}`
            );
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.collectorType}: ${params.label}`);

        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }

    start(): void {
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

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
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
                    ...fh
                        .e('RADIO States->')
                        .done,
                    ...this.decode<RadioStates>(radioStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? fh
                            .e(`${pLookup(index)}:`)
                            .e(s, 21)
                            .done : []
                    )
                ];
            }
            if (data[0] === '{') {
                //prettier-ignore
                return [
                    ...fh
                        .e('PORT States->')
                        .done,
                    ...this.decode<PortStates>(portStates, 16, result[1].split(' ')).flatMap((s, index) =>
                        s.length ? fh
                            .e(`${pLookup(index)}:`)
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
