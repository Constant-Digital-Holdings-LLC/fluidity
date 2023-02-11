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
import { IncomingMessage } from 'node:http';
import https from 'https';

const NODE_ENV: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
type SerialParser = ReadlineParser | RegexParser;

export interface DataCollectorParams extends Omit<FluidityPacket, 'formattedData'> {
    targets: PublishTarget[];
    omitTS?: boolean;
    keepRaw?: boolean;
    extendedOptions?: object;
    maxHttpsReqPerCollectorPerSec?: number;
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

interface HttpError extends Error {
    errno: number;
    code: string;
    syscall: string;
    address: string;
    port: number;
}

const isHttpError = (e: Error): e is HttpError => {
    return (
        'errno' in e &&
        typeof e.errno === 'number' &&
        'code' in e &&
        typeof e.code === 'string' &&
        'syscall' in e &&
        typeof e.syscall === 'string' &&
        'address' in e &&
        typeof e.address === 'string' &&
        'port' in e &&
        typeof e.port === 'number'
    );
};

export abstract class DataCollector implements DataCollectorPlugin {
    private throttle: <T = unknown>(fn: () => T | Promise<T>) => Promise<T>;

    constructor(public params: DataCollectorParams) {
        if (!isDataCollectorParams(params)) throw new Error(`DataCollector class constructor - invalid runtime params`);

        const { maxHttpsReqPerCollectorPerSec = 1 } = params;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);

        //@ts-ignore

        this.throttle = throttledQueue(maxHttpsReqPerCollectorPerSec, 1000);
    }

    abstract start(): void;

    abstract format(data: string, fh: FormatHelper): FormattedData[] | null;

    private addTS(data: FormattedData[]): FormattedData[] {
        return data;
    }

    private _reqJSON(method: 'POST' | 'GET', uo: URL, data?: any, key?: string): Promise<string> {
        const { protocol, hostname, port, pathname } = uo;

        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    protocol,
                    rejectUnauthorized: NODE_ENV === 'development' ? false : true,
                    hostname,
                    port,
                    method: method,
                    path: pathname,
                    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined
                },
                (res: IncomingMessage) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode && res.statusCode / 2 === 100) {
                            resolve(data);
                        } else {
                            req.end();
                            reject(`makeReq() non 200 series response`);
                        }
                    });
                    res.on('error', () => {
                        req.end();
                        reject(`makeReq() request error`);
                    });
                }
            );

            req.on('error', e => {
                if (e instanceof Error && isHttpError(e)) {
                    if (e.code === 'ECONNREFUSED') {
                        log.error(`Connection refused connecting to host ${e.address} on port ${e.port}`);
                    }
                } else {
                    log.error(e);
                }
            });

            method === 'POST' && req.write(JSON.stringify(data));

            req.end();
        });
    }

    protected async get(location: string): Promise<string> {
        return await this.throttle<string>(async () => {
            return await this._reqJSON('GET', new URL(location));
        });
    }

    private async post(location: string, data: any, key: string): Promise<string> {
        return await this.throttle<string>(async () => {
            return await this._reqJSON('POST', new URL(location), data, key);
        });
    }

    private async sendHttps(targets: PublishTarget[], fPacket: FluidityPacket): Promise<void> {
        log.debug(`to: ${JSON.stringify(targets)}`);
        log.debug(fPacket);

        for await (const { location, key } of targets) {
            try {
                await this.post(location, fPacket, key);
            } catch (err) {
                log.error(err);
            }
        }
    }

    protected send(data: string): void {
        const { targets, keepRaw, extendedOptions, omitTS, ...rest } = this.params;

        for (const [key, value] of Object.entries(process.memoryUsage())) {
            log.debug(`Memory usage by ${key}, ${value / 1000000}MB `);
        }

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

            try {
                this.send(await this.get(this.url.href));
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
