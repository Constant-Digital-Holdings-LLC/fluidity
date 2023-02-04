import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import {
    FormattedData,
    FluidityPacket,
    isFfluidityPacket,
    PublishTarget,
    FluidityField,
    StringAble
} from '#@shared/types.js';
import { setIntervalAsync } from 'set-interval-async';
import axios from 'axios';

const conf = await confFromFS();
const log = fetchLogger(conf);

type SerialParser = ReadlineParser | RegexParser;

export interface DataCollectorParams extends Omit<FluidityPacket, 'formattedData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    keepRaw?: boolean;
    extendedOptions?: object;
}

export const isDataCollectorParams = (obj: any): obj is DataCollectorParams => {
    const { targets, omitTS, keepRaw, extendedOptions } = obj;

    return (
        isFfluidityPacket(obj, true) &&
        Array.isArray(targets) &&
        Boolean(targets.length) &&
        (typeof omitTS === 'undefined' || typeof omitTS === 'boolean') &&
        (typeof keepRaw === 'undefined' || typeof keepRaw === 'boolean') &&
        (typeof extendedOptions === 'undefined' || extendedOptions instanceof Object)
    );
};

export interface SerialCollectorParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

export class FormatHelper {
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

export interface DataCollectorPlugin {
    start(): void;
    format(data: string, fh: FormatHelper): FormattedData[] | null;
}

export abstract class DataCollector implements DataCollectorPlugin {
    constructor(public params: DataCollectorParams) {
        if (!isDataCollectorParams(params)) throw new Error(`DataCollector class constructor - invalid runtime params`);
    }

    abstract start(): void;

    abstract format(data: string, fh: FormatHelper): FormattedData[] | null;

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(target: PublishTarget, fPacket: FluidityPacket): void {
        log.info(`${fPacket.plugin} [${fPacket.description}]:\t\tPOST ${target.location}`);
        log.debug('############### BEGIN ONE HTTP POST ###############');
        log.debug(fPacket);
        log.debug('############### END ONE HTTP POST   ###############');
    }

    protected send(data: string): void {
        const { site, description, plugin, targets, keepRaw } = this.params;

        let formattedData = this.format(data, new FormatHelper());

        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));
            try {
                targets.forEach(t => {
                    if (new URL(t.location).protocol === 'https:') {
                        if (formattedData) {
                            this.sendHttps(t, {
                                site,
                                description,
                                plugin,
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

export interface WebJSONCollectorParams extends DataCollectorParams {
    url: string;
    pollIntervalSec: number;
}

export abstract class WebJSONCollector extends DataCollector implements DataCollectorPlugin {
    protected url: URL;
    protected pollIntervalSec: number;

    constructor({ url, pollIntervalSec, ...params }: WebJSONCollectorParams) {
        super(params);

        if (typeof url !== 'string') {
            throw new Error(`missing url (string) in config for ${params.plugin}: ${params.description}`);
        }

        if (typeof pollIntervalSec !== 'number') {
            throw new Error(`missing pollIntervalSec (number) in config for ${params.plugin}: ${params.description}`);
        }

        this.url = new URL(url);
        this.pollIntervalSec = pollIntervalSec;
    }

    start(): void {
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);

        setIntervalAsync(async () => {
            log.info(`${this.params.plugin} [${this.params.description}]: contacting host...(${this.url.host})`);

            //prevent axios from deserializing JSON automatically
            const myAxios = axios.create({
                transformResponse: [
                    function transformResponse(data) {
                        return data;
                    }
                ]
            });

            try {
                this.send((await myAxios.get(this.url.href)).data);
            } catch (err) {
                log.error(err);
            }
        }, this.pollIntervalSec * 1000);
    }
}

export interface SerialCollectorPlugin extends DataCollectorPlugin {
    fetchParser(): SerialParser;
}

export abstract class SerialCollector extends DataCollector implements SerialCollectorPlugin {
    protected port: SerialPort;
    protected parser: SerialParser;

    abstract fetchParser(): SerialParser;

    override format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    constructor({ path, baudRate, ...params }: SerialCollectorParams) {
        super(params);

        if (typeof path !== 'string')
            throw new Error(
                `expected serial port identifier (string) in config for ${params.plugin}: ${params.description}`
            );
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.plugin}: ${params.description}`);

        this.port = new SerialPort({ path, baudRate });
        this.parser = this.port.pipe(this.fetchParser());
    }

    start(): void {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }
}
