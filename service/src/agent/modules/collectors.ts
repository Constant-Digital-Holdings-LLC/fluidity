import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, SerialPortMock, ReadlineParser, RegexParser } from 'serialport';
import { simProfileFromPath, startFeeder } from '#@sims/index.js';
import {
    FormattedData,
    FluidityPacket,
    isFfluidityPacket,
    PublishTarget,
    StringAble,
    NodeEnv,
    isFluidityLink,
    FluidityLink,
    isObject
} from '#@shared/types.js';

import throttledQueue from 'throttled-queue';

const conf = await confFromFS();
const log = fetchLogger(conf);
import { IncomingMessage } from 'node:http';
import https from 'https';

const NODE_ENV: NodeEnv = process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
type SerialParser = ReadlineParser | RegexParser;

export interface DataCollectorParams extends Omit<FluidityPacket, 'formattedData' | 'seq' | 'ts'> {
    targets: PublishTarget[];
    keepRaw?: boolean;
    extendedOptions?: object;
    maxHttpsReqPerCollectorPerSec?: number;
}

export const isDataCollectorParams = (item: unknown): item is DataCollectorParams => {
    const { targets, keepRaw, extendedOptions } = item as Partial<DataCollectorParams>;

    return (
        isFfluidityPacket(item, true) &&
        Array.isArray(targets) &&
        Boolean(targets.length) &&
        (typeof keepRaw === 'undefined' || typeof keepRaw === 'boolean') &&
        (typeof extendedOptions === 'undefined' || isObject(extendedOptions))
    );
};

export interface SerialCollectorParams extends DataCollectorParams {
    path: string;
    baudRate: number;
}

export class FormatHelper {
    private formattedData: FormattedData[] = [];

    e(element: FluidityLink | StringAble | Date, suggestStyle?: number): this {
        suggestStyle ??= 0;
        if (typeof element === 'string') {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'STRING' });
        } else if (isFluidityLink(element)) {
            this.formattedData.push({ suggestStyle, field: element, fieldType: 'LINK' });
        } else if (element instanceof Date) {
            this.formattedData.push({ suggestStyle, field: element.toISOString(), fieldType: 'DATE' });
        } else {
            this.formattedData.push({ suggestStyle, field: element.toString(), fieldType: 'STRING' });
        }

        return this;
    }

    get done(): FormattedData[] {
        const clone = JSON.parse(JSON.stringify(this.formattedData)) as FormattedData[];
        this.formattedData.length = 0;
        return clone;
    }
}

export interface DataCollectorPlugin {
    start(): void;
    format(data: string, fh: FormatHelper): FormattedData[] | null;
}

interface SysError {
    errno: number;
    code: string;
    syscall: string;
}

interface HttpError extends SysError {
    address: string;
    port: number;
}

const isSysError = (e: unknown): e is SysError => {
    return (
        isObject(e) &&
        'errno' in e &&
        typeof e.errno === 'number' &&
        'code' in e &&
        typeof e.code === 'string' &&
        'syscall' in e &&
        typeof e.syscall === 'string'
    );
};

const isHttpError = (e: unknown): e is HttpError => {
    return (
        isSysError(e) && 'address' in e && typeof e.address === 'string' && 'port' in e && typeof e.port === 'number'
    );
};

export abstract class DataCollector implements DataCollectorPlugin {
    private throttle: <T = unknown>(fn: () => T | Promise<T>) => Promise<T>;

    constructor(public params: DataCollectorParams) {
        if (!isDataCollectorParams(params)) throw new Error(`DataCollector class constructor - invalid runtime params`);

        const { maxHttpsReqPerCollectorPerSec = 2 } = params;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);

        //This module isn't working too well with es-iterop

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        this.throttle = throttledQueue(maxHttpsReqPerCollectorPerSec, 1000);
    }

    abstract start(): void;

    abstract format(data: string, fh: FormatHelper): FormattedData[] | null;

    private _reqJSON(method: 'POST' | 'GET', uo: URL, data?: unknown, key?: string): Promise<string> {
        const { protocol, hostname, port, pathname } = uo;

        return new Promise((resolve, reject) => {
            if (method === 'POST') {
                if (!key) {
                    reject(new Error(`DataCollector: missing API key for ${uo.toString()}`));
                    return;
                }

                if (!/^[a-zA-Z0-9]+$/.test(key)) {
                    reject(
                        new Error(
                            `Invalid key format - API keys should be alphanumeric\nConsider using the bin/genApiKey utility`
                        )
                    );
                    return;
                }
            }

            const req = https.request(
                {
                    protocol,
                    rejectUnauthorized: NODE_ENV === 'development' ? false : true,
                    hostname,
                    port,
                    method: method,
                    path: pathname,
                    headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Api-Key': key } : undefined
                },
                (res: IncomingMessage) => {
                    let data = '';
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode === 401) {
                            log.warn('Server responded with: Unauthorized');
                            log.warn('Agent likely using invalidated api-key');
                        }
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(data);
                        } else {
                            req.end();
                            reject(new Error(`makeReq() non 200 series response (${res.statusCode ?? 'none'})`));
                        }
                    });
                    res.on('error', () => {
                        req.end();
                        reject(new Error(`makeReq() request error`));
                    });
                }
            );

            req.on('error', e => {
                req.end();
                if (isHttpError(e) && e.code === 'ECONNREFUSED') {
                    reject(new Error(`Connection REFUSED connecting to host ${e.address} on port ${e.port}`));
                } else if (isSysError(e) && e.code === 'ECONNRESET') {
                    reject(new Error(`Connection RESET during ${e.syscall}`));
                } else {
                    reject(e);
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

    protected async post(location: string, data: unknown, key: string): Promise<string> {
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
        const { targets, keepRaw, ...rest } = this.params;

        for (const [key, value] of Object.entries(process.memoryUsage())) {
            log.debug(`Memory usage by ${key}, ${value / 1000000}MB `);
        }

        const formattedData = this.format(data, new FormatHelper());

        if (Array.isArray(formattedData) && formattedData.length) {
            this.sendHttps(targets, {
                ts: new Date().toISOString(),
                formattedData,
                rawData: keepRaw ? data : null,
                ...rest
            }).catch(err => {
                log.warn(err);
            });
        } else {
            log.debug(`DataCollector: ignoring string: ${data}`);
        }
    }
}

export interface PollingCollectorParams extends DataCollectorParams {
    pollIntervalSec: number;
    notifyIntervalSec?: number;
}

export interface WebJSONCollectorParams extends PollingCollectorParams {
    url: string;
}

export abstract class PollingCollector extends DataCollector implements DataCollectorPlugin {
    protected pollIntervalSec: number;
    protected timer: NodeJS.Timeout | undefined;

    constructor({ pollIntervalSec, ...params }: PollingCollectorParams) {
        super(params);

        if (typeof pollIntervalSec !== 'number') {
            throw new Error(
                `polling collectors require pollIntervalSec in constructor ${params.plugin}: ${params.description}`
            );
        }

        this.pollIntervalSec = pollIntervalSec;
    }

    format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    abstract execPerInterval(): void;

    start(): void {
        try {
            log.info(`started: ${this.params.plugin} [${this.params.description}]`);
            this.execPerInterval();
            this.timer = setTimeout(this.start.bind(this), this.pollIntervalSec * 1000);
        } catch (err) {
            log.error(err);
        }
    }

    stop(): void {
        if (this.timer) clearTimeout(this.timer);
    }
}

export abstract class WebJSONCollector extends PollingCollector implements DataCollectorPlugin {
    protected url: URL;

    constructor({ url, ...params }: WebJSONCollectorParams) {
        super(params);

        if (typeof url !== 'string') {
            throw new Error(`missing url (string) in config for ${params.plugin}: ${params.description}`);
        }

        this.url = new URL(url);
    }

    execPerInterval(): void {
        this.get(this.url.href)
            .then(data => {
                log.info(`${this.params.plugin} [${this.params.description}]: contacting host...(${this.url.host})`);
                this.send(data);
            })
            .catch(err => {
                log.error(err);
            });
    }
}

export interface SerialCollectorPlugin extends DataCollectorPlugin {
    fetchParser(): SerialParser;
}

export abstract class SerialCollector extends DataCollector implements SerialCollectorPlugin {
    protected port: SerialPort | SerialPortMock;
    protected parser: SerialParser;

    abstract fetchParser(): SerialParser;

    format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    //single seam for port construction: real device, sim:// virtual device, or test override
    protected openPort(path: string, baudRate: number): SerialPort | SerialPortMock {
        const onOpenError = (err: Error | null): void => {
            if (err?.stack) log.error(err.stack);
        };

        const profile = simProfileFromPath(path);

        if (profile) {
            SerialPortMock.binding.createPort(path);
            const port = new SerialPortMock({ path, baudRate }, onOpenError);

            port.on('open', () => {
                log.info(
                    `${this.params.plugin} [${this.params.description}]: simulating serial device on ${path} (profile: ${profile.name})`
                );
                const feeder = startFeeder(profile, chunk => port.port?.emitData(chunk));
                port.on('close', () => feeder.stop());
            });

            return port;
        }

        return new SerialPort({ path, baudRate }, onOpenError);
    }

    constructor({ path, baudRate, ...params }: SerialCollectorParams) {
        super(params);

        if (typeof path !== 'string')
            throw new Error(
                `expected serial port identifier (string) in config for ${params.plugin}: ${params.description}`
            );
        if (typeof baudRate !== 'number')
            throw new Error(`expected numeric port speed in config for ${params.plugin}: ${params.description}`);

        this.port = this.openPort(path, baudRate);
        this.parser = this.port.pipe(this.fetchParser());
    }

    start(): void {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }
}
