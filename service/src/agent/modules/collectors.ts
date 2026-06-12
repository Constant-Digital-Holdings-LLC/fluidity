import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { SerialPort, SerialPortMock, ReadlineParser, RegexParser } from 'serialport';
import { simProfileFromPath, startFeeder } from '#@sims/index.js';
import {
    FormattedData,
    FluidityPacket,
    isFfluidityPacket,
    isApiKeyFormat,
    PublishTarget,
    StringAble,
    NodeEnv,
    isFluidityLink,
    FluidityLink,
    isObject
} from '#@shared/types.js';
import { nodeEnv } from '#@shared/modules/utils.js';

import { throttledQueue } from 'throttled-queue';

const conf = await confFromFS();
const log = fetchLogger(conf);
import { IncomingMessage } from 'node:http';
import https from 'https';

const NODE_ENV: NodeEnv = nodeEnv();
type SerialParser = ReadlineParser | RegexParser;

//absolute ceiling on in-flight upstream posts, independent of the throttle.
//A few thousand outstanding requests is more than any responsive server
//needs; past it we are buffering RAM for a target that cannot keep up.
const MAX_PENDING_POSTS_ABS = 1024;

//a target that accepts TCP but never answers must not pin a pendingPosts
//slot forever - without this, maxPendingPosts hung requests would wedge the
//collector into shedding 100% of traffic until restart
const REQUEST_TIMEOUT_MS = 10_000;

//an unplugged device surfaces as a 'close' event; retry the open on this
//cadence until it comes back
const SERIAL_REOPEN_MS = 5_000;

//mirror the TUI's verify policy (tui/src/modules/transport.ts): cert
//verification is relaxed only for loopback targets in development - an env
//var must never disable verification for a remote host
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const shouldVerifyTLS = (hostname: string): boolean => !(NODE_ENV === 'development' && LOOPBACK_HOSTS.has(hostname));

//extract one key from a collector's extendedOptions stanza (undefined when
//absent); validation and warn-vs-throw policy stay with the caller -
//security options throw at startup, presentation options warn and default
export const extOpt = (eo: object | undefined, key: string): unknown =>
    eo && key in eo ? (eo as Record<string, unknown>)[key] : undefined;

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
        //hand off the buffer and start fresh - every element was constructed
        //by e() and never retained, so no defensive copy is needed
        const out = this.formattedData;
        this.formattedData = [];
        return out;
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
    private pendingPosts = 0;
    private readonly maxPendingPosts: number;
    private shedTotal = 0;
    //target locations are constant for the collector's lifetime
    private readonly urlCache = new Map<string, URL>();
    //per-reason drop accounting, one surface for every collector (srsSerial
    //and udpStruct previously each hand-rolled an identical copy)
    protected readonly drops = new Map<string, number>();

    constructor(public params: DataCollectorParams) {
        if (!isDataCollectorParams(params)) throw new Error(`DataCollector class constructor - invalid runtime params`);

        const { maxHttpsReqPerCollectorPerSec = 2 } = params;
        log.info(`Agent: maxHttpsReqPerCollectorPerSec: ${maxHttpsReqPerCollectorPerSec}`);

        this.throttle = throttledQueue({ maxPerInterval: maxHttpsReqPerCollectorPerSec, interval: 1000 });

        //the throttle queues without limit, so any source that can outrun it
        //(UDP barrage, serial line noise through genericSerial, a tight
        //poller) would grow memory forever; dispatch() sheds beyond this.
        //Scaled to the throttle, but hard-capped: a load test showed a high
        //throttle (100k) let the backlog reach ~200k posts and ~1.6GB RSS.
        //With a fast upstream the in-flight count stays far below this cap
        //(it is throttle x round-trip latency), so the ceiling only bites a
        //genuinely stalled/saturated target - exactly when shedding is right.
        this.maxPendingPosts = Math.min(MAX_PENDING_POSTS_ABS, Math.max(32, 2 * maxHttpsReqPerCollectorPerSec));
    }

    abstract start(): void;

    //release any timers/handles so the process can exit cleanly
    stop(): void {}

    abstract format(data: string, fh: FormatHelper): FormattedData[] | null;

    //resolve and memoize - dispatch runs per packet, the location strings
    //never change
    protected urlFor(location: string): URL {
        let uo = this.urlCache.get(location);
        if (!uo) {
            uo = new URL(location);
            this.urlCache.set(location, uo);
        }
        return uo;
    }

    protected noteDrop(reason: string): number {
        const n = (this.drops.get(reason) ?? 0) + 1;
        this.drops.set(reason, n);
        return n;
    }

    public get dropCounts(): ReadonlyMap<string, number> {
        return this.drops;
    }

    private _reqJSON(method: 'POST' | 'GET', uo: URL, data?: unknown, key?: string): Promise<string> {
        const { protocol, hostname, port, pathname, search } = uo;

        return new Promise((resolve, reject) => {
            if (method === 'POST') {
                if (!key) {
                    reject(new Error(`DataCollector: missing API key for ${uo.toString()}`));
                    return;
                }

                if (!isApiKeyFormat(key)) {
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
                    rejectUnauthorized: shouldVerifyTLS(hostname),
                    hostname,
                    port,
                    method: method,
                    //the query string is part of the resource
                    path: pathname + search,
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Api-Key': key } : undefined
                },
                (res: IncomingMessage) => {
                    //decode as a stream: per-chunk Buffer.toString would
                    //corrupt a multibyte char split across TCP chunks
                    res.setEncoding('utf8');
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

            //'timeout' is inactivity, not failure: destroy with an error so
            //the 'error' path below settles the promise and releases the
            //pendingPosts slot
            req.on('timeout', () => {
                req.destroy(new Error(`request to ${hostname} timed out after ${REQUEST_TIMEOUT_MS}ms`));
            });

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
            return await this._reqJSON('GET', this.urlFor(location));
        });
    }

    protected async post(location: string, data: unknown, key: string): Promise<string> {
        return await this.throttle<string>(async () => {
            return await this._reqJSON('POST', this.urlFor(location), data, key);
        });
    }

    private async sendHttps(targets: PublishTarget[], fPacket: FluidityPacket): Promise<void> {
        //objects, not templates: the logger serializes after its level gate
        log.debug(targets);
        log.debug(fPacket);

        for (const { location, key } of targets) {
            try {
                await this.post(location, fPacket, key);
            } catch (err) {
                log.error(err);
            }
        }
    }

    //every upstream publish flows through here. The backlog is bounded:
    //when the throttled path is saturated, the newest packet is shed (and
    //the shed is observable) - on a fire-and-forget display feed a flood
    //must cost lines, never agent memory. The queue offers no cancellation,
    //so shedding old work in favor of fresh is not an option.
    private dispatch(fPacket: FluidityPacket): Promise<void> {
        if (this.pendingPosts >= this.maxPendingPosts) {
            this.shedTotal++;
            if (this.shedTotal <= 5 || this.shedTotal % 100 === 0) {
                log.warn(
                    `${this.params.plugin} [${this.params.description}]: upstream saturated ` +
                        `(${this.pendingPosts} posts in flight) - shedding newest packet (total shed ${this.shedTotal})`
                );
            }
            return Promise.resolve();
        }

        this.pendingPosts++;
        return this.sendHttps(this.params.targets, fPacket)
            .catch(err => {
                log.warn(err);
            })
            .finally(() => {
                this.pendingPosts--;
            });
    }

    //true while dispatch() would shed: collectors with richer accounting
    //(udpStruct counts per source address) check this before building
    protected get upstreamSaturated(): boolean {
        return this.pendingPosts >= this.maxPendingPosts;
    }

    //total packets shed by the backpressure bound, for tests and surfaces
    public get backpressureShed(): number {
        return this.shedTotal;
    }

    protected send(data: string): void {
        const { site, plugin, description, keepRaw } = this.params;

        const formattedData = this.format(data, new FormatHelper());

        if (Array.isArray(formattedData) && formattedData.length) {
            //an exact FluidityPacket - nothing else from the config stanza
            //(extendedOptions, throttle settings, unknown keys) may ride
            //along: the server relays bodies verbatim to unauthenticated
            //SSE/FIFO clients
            void this.dispatch({
                site,
                plugin,
                description,
                ts: new Date().toISOString(),
                formattedData,
                rawData: keepRaw ? data : null
            });
        } else {
            log.debug(`DataCollector: ignoring string: ${data}`);
        }
    }

    //per-packet construction seam for collectors whose wire format carries
    //its own identity (udpStruct: site/plugin/description/ts arrive in each
    //datagram). Builds an exact FluidityPacket - per-packet values win over
    //collector params - and rides the same bounded, throttled path as send().
    //Resolves when the upstream attempt settles (never rejects).
    protected sendPacket(
        formattedData: FormattedData[],
        perPacket: Partial<Pick<FluidityPacket, 'site' | 'plugin' | 'description' | 'ts'>> & {
            rawData?: string | null;
        } = {}
    ): Promise<void> {
        if (!formattedData.length) return Promise.resolve();

        const { rawData = null, ...overrides } = perPacket;
        const { site, plugin, description } = this.params;

        return this.dispatch({
            site,
            plugin,
            description,
            ts: new Date().toISOString(),
            formattedData,
            rawData,
            ...overrides
        });
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
    private pollStopped = false;

    constructor({ pollIntervalSec, ...params }: PollingCollectorParams) {
        super(params);

        //0/negative/NaN would clamp setTimeout to ~1ms - a hot spin that
        //floods logs and grows the throttle queue without bound
        if (typeof pollIntervalSec !== 'number' || !Number.isFinite(pollIntervalSec) || pollIntervalSec < 1) {
            throw new Error(
                `polling collectors require pollIntervalSec >= 1 in constructor ${params.plugin}: ${params.description}`
            );
        }

        this.pollIntervalSec = pollIntervalSec;
    }

    format(data: string, fh: FormatHelper): FormattedData[] | null {
        return fh.e(data).done;
    }

    abstract execPerInterval(): void;

    start(): void {
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
        this.runPoll();
    }

    private runPoll(): void {
        try {
            this.execPerInterval();
        } catch (err) {
            //a throwing poll must never kill the loop - log it and keep polling
            log.error(err);
        } finally {
            if (!this.pollStopped) {
                this.timer = setTimeout(this.runPoll.bind(this), this.pollIntervalSec * 1000);
            }
        }
    }

    override stop(): void {
        this.pollStopped = true;
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
    private closing = false;
    private reopenTimer: NodeJS.Timeout | undefined;

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

        //pipe() does not forward errors, and serialport surfaces a runtime
        //disconnect (USB unplug) as 'close' with a disconnect error - with
        //neither handler the feed would die completely silently
        this.port.on('error', err => {
            log.error(`${this.params.plugin} [${this.params.description}]: serial error: ${err.message}`);
        });
        this.parser.on('error', (err: Error) => {
            log.error(`${this.params.plugin} [${this.params.description}]: parser error: ${err.message}`);
        });
        this.port.on('close', (err?: Error | null) => {
            if (this.closing) return;
            log.warn(
                `${this.params.plugin} [${this.params.description}]: serial port closed` +
                    `${err ? ` (${err.message})` : ''} - retrying open every ${SERIAL_REOPEN_MS / 1000}s`
            );
            this.scheduleReopen();
        });
    }

    private scheduleReopen(): void {
        this.reopenTimer = setTimeout(() => {
            if (this.closing) return;
            this.port.open(err => {
                if (err) {
                    this.scheduleReopen();
                } else {
                    //the close detached the pipe; unpipe first so a retained
                    //attachment can't double-deliver
                    this.port.unpipe(this.parser);
                    this.port.pipe(this.parser);
                    log.info(`${this.params.plugin} [${this.params.description}]: serial port reopened`);
                }
            });
        }, SERIAL_REOPEN_MS);
    }

    start(): void {
        this.parser.on('data', this.send.bind(this));
        log.info(`started: ${this.params.plugin} [${this.params.description}]`);
    }

    override stop(): void {
        this.closing = true;
        if (this.reopenTimer) clearTimeout(this.reopenTimer);
        if (this.port.isOpen) {
            this.port.close();
        } else {
            this.port.once('open', () => this.port.close());
        }
    }
}
