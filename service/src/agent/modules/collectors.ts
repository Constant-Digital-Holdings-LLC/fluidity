import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, ReadlineParser, RegexParser } from 'serialport';
import {
    FormattedData,
    FluidityPacket,
    isFfluidityPacket,
    PublishTarget,
    FluidityField,
    StringAble,
    NodeEnv
} from '#@shared/types.js';
import { setIntervalAsync } from 'set-interval-async';
import throttledQueue from 'throttled-queue';

const conf = await confFromFS();
const log = fetchLogger(conf);

import https from 'https';
import axios from 'axios';

const NODE_ENV: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
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
    private throttle: any;
    public throttledAxios: any;

    constructor(public params: DataCollectorParams) {
        if (!isDataCollectorParams(params)) throw new Error(`DataCollector class constructor - invalid runtime params`);

        if (NODE_ENV === 'development') {
            axios.defaults.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
            log.warn(`collectors: Disabling TLS cert verification while NODE_ENV = development`);
        }

        //throttledQueue() missing TS call sig in lib
        //@ts-ignore
        this.throttle = throttledQueue(1, 1000);
    }

    abstract start(): void;

    abstract format(data: string, fh: FormatHelper): FormattedData[] | null;

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private sendHttps(targets: PublishTarget[], fPacket: FluidityPacket): void {
        log.debug(`to: ${JSON.stringify(targets)}`);
        log.debug(fPacket);

        targets.map(async ({ location, key }) => {
            try {
                return await this.throttle(
                    await axios.post(location, fPacket, {
                        maxRedirects: 0,
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent':
                                conf?.appName && conf.appVersion ? `${conf.appName} ${conf.appVersion}` : 'Fluidity',
                            'X-API-Key': key ?? null
                        }
                    })
                );
            } catch (err) {
                if (err instanceof Error) {
                    const res = err.message.match(/.*\s+([A-Z]+)\s+(.*)/);

                    if (res && res[1] === 'ECONNREFUSED') {
                        log.error(`sendHttps() POST: Connection refused connecting to ${res[2]}`);
                    } else {
                        log.error(`sendHttps() POST: ${err.message}`);
                    }
                } else {
                    log.error(`sendHttps() POST: ${err}`);
                }
            }
        });

        log.debug('-------------------------------------------------');

        for (const [key, value] of Object.entries(process.memoryUsage())) {
            log.debug(`Memory usage by ${key}, ${value / 1000000}MB `);
        }
    }

    protected send(data: string): void {
        const { targets, keepRaw, extendedOptions, omitTS, ...rest } = this.params;

        let formattedData = this.format(data, new FormatHelper());

        if (formattedData) {
            !this.params.omitTS && (formattedData = this.addTS(formattedData));

            this.sendHttps(targets, { formattedData, rawData: keepRaw ? data : null, ...rest });
        } else {
            log.warn(`DataCollector: ignoring unkown string: ${data}`);
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
