import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { FormattedData, isObject } from '#@shared/types.js';
import { DataCollector, DataCollectorParams, extOpt } from '../collectors.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const conf = await confFromFS();

const log = fetchLogger(conf);

export interface WebhookJsonCollectorParams extends DataCollectorParams {
    port?: number;
    bind?: string;
}

//the agent's HTTP gateway, the L7 sibling of the udpStruct UDP gateway: a
//third-party system that can only emit webhooks (Uptime Kuma, Grafana, CI,
//home automation) POSTs its native JSON here, and a per-route mapping config
//turns it into FluidityPackets - so external sources need no fluidity-aware
//client, and bespoke per-integration adapter services disappear.
//
//Doctrine notes, mirroring udpStruct:
//  - plain-HTTP listener intended for the LAN (front it with a reverse proxy
//    if it must cross one); optional bearer-token auth, and any misconfigured
//    security option refuses to start rather than warn-and-weaken
//  - mapping is config, not code: dot-paths select values, value tables
//    translate them (e.g. a status code to a routing prefix like "[P5]"),
//    styles are suggestions - the server still relays without interpreting
//  - a webhook gateway funnels many sources through one upstream throttle,
//    so it defaults to a fleet rate, not the per-device 2/s
const WEBHOOK_FLEET_DEFAULT_THROTTLE = 50;

//webhook payloads are small (Kuma's is ~2KB); anything past this is not a
//notification, it's a mistake or mischief
const MAX_BODY_BYTES = 256 * 1024;

//per-reason log damping: counters always increment, the log shows the first
//few and then every 100th (one chattering misconfigured sender must not own
//the log)
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;

type CountReason =
    | 'bad-json'
    | 'no-route'
    | 'bad-method'
    | 'oversize'
    | 'unauthorized'
    | 'empty-mapping'
    | 'backpressure';

interface FieldSpec {
    segs: string[] | null; //dot-path into the payload (null for a const field)
    constVal: string | null;
    map: Map<string, string> | null; //value translation, keyed on the extracted string
    mapDefault: string | undefined; //when the path is absent or the map misses
    style: number; //static suggestStyle (default 0)
    styleMap: Map<string, number> | null; //value-keyed style, same key as map
}

interface Route {
    path: string;
    site: string | undefined; //per-route identity overrides (like udpStruct's
    plugin: string | undefined; //per-packet identity from the datagram)
    descSegs: string[] | null; //dot-path for the packet description
    descDefault: string | undefined; //static fallback before the collector description
    fields: FieldSpec[];
}

//walk a dot-path ("heartbeat.status", "items.0.name") through objects and
//arrays; undefined the moment a segment has nowhere to go
const resolvePath = (root: unknown, segs: string[]): unknown => {
    let cur: unknown = root;
    for (const s of segs) {
        if (Array.isArray(cur)) {
            cur = cur[Number(s)];
        } else if (isObject(cur)) {
            cur = (cur as Record<string, unknown>)[s];
        } else {
            return undefined;
        }
    }
    return cur;
};

//an extracted value as field text: strings ride as-is, scalars stringify,
//structures dump as JSON (so "from": "heartbeat" is the whole object), and
//absent stays absent for the default to handle
const asText = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
};

const parseSegs = (raw: unknown, where: string): string[] => {
    if (typeof raw !== 'string' || !raw.length) throw new Error(`${where} must be a non-empty dot-path string`);
    const segs = raw.split('.');
    if (segs.some(s => !s.length)) throw new Error(`${where}: "${raw}" has an empty path segment`);
    return segs;
};

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

export default class WebhookJsonCollector extends DataCollector {
    private readonly port: number;
    private readonly bindAddr: string | undefined;
    private readonly routes = new Map<string, Route>();
    private readonly tokenDigest: Buffer | null;
    private readonly server: http.Server;
    private readonly bound: Promise<number>;

    constructor(params: WebhookJsonCollectorParams) {
        //one gateway funnels every webhook source through one upstream
        //throttle (a host outage flips many Kuma monitors at once), so
        //default to a fleet rate when unset rather than the per-device 2
        super({
            ...params,
            maxHttpsReqPerCollectorPerSec: params.maxHttpsReqPerCollectorPerSec ?? WEBHOOK_FLEET_DEFAULT_THROTTLE
        });

        const where = `webhookJson [${params.description}]`;
        const { port, bind } = params;

        //0 binds an ephemeral port (test seam; the bound port is logged)
        if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65535) {
            throw new Error(`${where}: port must be an integer 0..65535`);
        }
        this.port = port as number;

        if (bind !== undefined && typeof bind !== 'string') {
            throw new Error(`${where}: bind must be an interface address string`);
        }
        this.bindAddr = bind;

        const eo = params.extendedOptions;

        //auth config degrades LOUDLY (the udpStruct doctrine): a present-but-
        //broken token must refuse to start, not silently run open
        const token = extOpt(eo, 'token');
        if (token !== undefined && (typeof token !== 'string' || !token.length)) {
            throw new Error(`${where}: token must be a non-empty string (omit it entirely for open mode)`);
        }
        this.tokenDigest = typeof token === 'string' ? sha256(token) : null;

        const routesRaw = extOpt(eo, 'routes');
        if (!Array.isArray(routesRaw) || !routesRaw.length) {
            throw new Error(`${where}: extendedOptions.routes must be a non-empty array`);
        }
        routesRaw.forEach((r, i) => {
            const rw = `${where}: routes[${i}]`;
            if (!isObject(r)) throw new Error(`${rw} must be an object`);
            const o = r as Record<string, unknown>;

            if (typeof o['path'] !== 'string' || !o['path'].startsWith('/')) {
                throw new Error(`${rw}.path must be a string starting with "/"`);
            }
            if (o['path'] === '/health') throw new Error(`${rw}.path: /health is reserved for the liveness probe`);
            if (this.routes.has(o['path'])) throw new Error(`${rw}.path: duplicate route "${o['path']}"`);

            for (const k of ['site', 'plugin'] as const) {
                const v = o[k];
                if (v !== undefined && (typeof v !== 'string' || !v.length)) {
                    throw new Error(`${rw}.${k} must be a non-empty string`);
                }
            }
            if (o['description'] !== undefined && typeof o['description'] !== 'string') {
                throw new Error(`${rw}.description must be a string`);
            }

            const fieldsRaw = o['fields'];
            if (!Array.isArray(fieldsRaw) || !fieldsRaw.length) {
                throw new Error(`${rw}.fields must be a non-empty array`);
            }
            const fields = fieldsRaw.map((f, j) => this.parseField(f, `${rw}.fields[${j}]`));

            this.routes.set(o['path'], {
                path: o['path'],
                site: o['site'] as string | undefined,
                plugin: o['plugin'] as string | undefined,
                descSegs:
                    o['descriptionFrom'] !== undefined
                        ? parseSegs(o['descriptionFrom'], `${rw}.descriptionFrom`)
                        : null,
                descDefault: o['description'],
                fields
            });
        });

        this.server = http.createServer((req, res) => this.handle(req, res));
        this.bound = new Promise((resolve, reject) => {
            this.server.once('listening', () => resolve((this.server.address() as AddressInfo).port));
            this.server.once('error', reject);
        });
        this.bound.catch(() => undefined); //observed via ready(); never unhandled
    }

    private parseField(raw: unknown, fw: string): FieldSpec {
        if (!isObject(raw)) throw new Error(`${fw} must be an object`);
        const o = raw as Record<string, unknown>;

        const hasFrom = o['from'] !== undefined;
        const hasConst = o['const'] !== undefined;
        if (hasFrom === hasConst) {
            throw new Error(`${fw} needs exactly one of "from" (a dot-path) or "const" (a literal)`);
        }
        if (hasConst && typeof o['const'] !== 'string') throw new Error(`${fw}.const must be a string`);
        for (const k of ['map', 'default', 'styleMap'] as const) {
            if (hasConst && o[k] !== undefined) throw new Error(`${fw}.${k} only applies with "from"`);
        }

        let map: Map<string, string> | null = null;
        if (o['map'] !== undefined) {
            if (!isObject(o['map'])) throw new Error(`${fw}.map must be an object of string values`);
            map = new Map();
            for (const [k, v] of Object.entries(o['map'] as Record<string, unknown>)) {
                if (typeof v !== 'string') throw new Error(`${fw}.map["${k}"] must be a string`);
                map.set(k, v);
            }
        }
        if (o['default'] !== undefined && typeof o['default'] !== 'string') {
            throw new Error(`${fw}.default must be a string`);
        }

        const style = o['suggestStyle'] ?? 0;
        if (typeof style !== 'number' || !Number.isInteger(style) || style < 0) {
            throw new Error(`${fw}.suggestStyle must be a non-negative integer`);
        }
        let styleMap: Map<string, number> | null = null;
        if (o['styleMap'] !== undefined) {
            if (!isObject(o['styleMap'])) throw new Error(`${fw}.styleMap must be an object of numeric styles`);
            styleMap = new Map();
            for (const [k, v] of Object.entries(o['styleMap'] as Record<string, unknown>)) {
                if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
                    throw new Error(`${fw}.styleMap["${k}"] must be a non-negative integer`);
                }
                styleMap.set(k, v);
            }
        }

        return {
            segs: hasFrom ? parseSegs(o['from'], `${fw}.from`) : null,
            constVal: hasConst ? (o['const'] as string) : null,
            map,
            mapDefault: o['default'],
            style,
            styleMap
        };
    }

    //resolves with the bound port once listening (tests bind port 0)
    public ready(): Promise<number> {
        return this.bound;
    }

    start(): void {
        this.server.on('error', err => {
            //a bind failure (EADDRINUSE/EACCES) lands here, not as a throw;
            //make it loud - this collector's ingest is dead, though other
            //collectors in the agent keep running
            log.error(
                `webhookJson [${this.params.description}]: server error on ` +
                    `${this.bindAddr ?? '0.0.0.0'}:${this.port} - webhook ingest for this collector is offline: ${err.message}`
            );
        });

        this.server.on('listening', () => {
            const { address, port } = this.server.address() as AddressInfo;
            log.info(`started: ${this.params.plugin} [${this.params.description}] on http ${address}:${port}`);
            log.info(
                `webhookJson [${this.params.description}]: routes ${[...this.routes.keys()].join(', ')} ` +
                    `(+ /health); upstream throttle ${this.maxPostsPerSec} posts/sec`
            );

            //the security posture is one glance at the log, always
            if (!this.tokenDigest) {
                log.info(
                    `webhookJson [${this.params.description}]: open mode - no token required; ` +
                        `keep this port LAN-only`
                );
            } else {
                log.info(
                    `webhookJson [${this.params.description}]: token mode - ` +
                        `bearer token required (Authorization or x-webhook-token)`
                );
            }
        });

        this.server.listen(this.port, this.bindAddr);
    }

    override stop(): void {
        this.server.closeAllConnections();
        this.server.close();
    }

    //webhooks arrive via handle(), not the line-oriented send() path
    format(): FormattedData[] | null {
        return null;
    }

    private damp(reason: CountReason, detail: string): number {
        const n = this.noteDrop(reason);
        if (n <= DAMP_AFTER || n % DAMP_EVERY === 0) {
            log.debug(`webhookJson [${this.params.description}]: ${reason} #${n} - ${detail}`);
        }
        return n;
    }

    private authorized(req: http.IncomingMessage): boolean {
        if (!this.tokenDigest) return true;
        const auth = req.headers['authorization'];
        const presented =
            typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-webhook-token'];
        if (typeof presented !== 'string' || !presented.length) return false;
        //fixed-length digests + timingSafeEqual: response timing leaks nothing
        //about how much of a candidate token matched (same as the server's key check)
        return timingSafeEqual(sha256(presented), this.tokenDigest);
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
        const pathname = new URL(req.url ?? '/', 'http://gateway').pathname;

        if (req.method === 'GET' && pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
            return;
        }

        const route = this.routes.get(pathname);
        if (!route) {
            this.damp('no-route', `${req.method ?? '?'} ${pathname} from ${req.socket.remoteAddress ?? '?'}`);
            res.writeHead(404);
            res.end();
            return;
        }
        if (req.method !== 'POST') {
            this.damp('bad-method', `${req.method ?? '?'} ${pathname}`);
            res.writeHead(405, { Allow: 'POST' });
            res.end();
            return;
        }
        if (!this.authorized(req)) {
            this.damp('unauthorized', `${pathname} from ${req.socket.remoteAddress ?? '?'}`);
            res.writeHead(401);
            res.end();
            return;
        }

        let body = '';
        let over = false;
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
            if (over) return;
            body += chunk;
            if (body.length > MAX_BODY_BYTES) {
                over = true;
                this.damp('oversize', `${pathname}: body exceeded ${MAX_BODY_BYTES} bytes`);
                res.writeHead(413);
                res.end();
                req.destroy();
            }
        });
        req.on('error', () => undefined); //destroyed oversize reqs error here; already answered
        req.on('end', () => {
            if (over) return;
            let payload: unknown;
            try {
                payload = JSON.parse(body);
            } catch {
                this.damp('bad-json', `${pathname}: unparseable body (${body.length} bytes)`);
                res.writeHead(400);
                res.end('body is not JSON');
                return;
            }
            this.publish(route, payload, body, res);
        });
    }

    private publish(route: Route, payload: unknown, raw: string, res: http.ServerResponse): void {
        const formattedData: FormattedData[] = [];
        for (const f of route.fields) {
            if (f.constVal !== null) {
                formattedData.push({ suggestStyle: f.style, field: f.constVal, fieldType: 'STRING' });
                continue;
            }
            const extracted = asText(resolvePath(payload, f.segs as string[]));
            //value translation: the table wins, then the default, then the
            //raw value rides through; an absent value only the default saves
            const text = extracted !== undefined ? (f.map?.get(extracted) ?? f.mapDefault ?? extracted) : f.mapDefault;
            if (text === undefined) continue; //nothing extracted, no default: omit the field
            const style = (extracted !== undefined ? f.styleMap?.get(extracted) : undefined) ?? f.style;
            formattedData.push({ suggestStyle: style, field: text, fieldType: 'STRING' });
        }

        if (!formattedData.length) {
            //accepted but unmappable (every field absent with no default):
            //answer 200 so the sender doesn't retry, but count it - a webhook
            //source whose shape changed shows up here
            this.damp('empty-mapping', `${route.path}: no fields extracted`);
            res.writeHead(200);
            res.end('ok (empty)');
            return;
        }

        //the base class would shed anyway; checking first lets the sender see
        //an honest 503 instead of a swallowed accept
        if (this.upstreamSaturated) {
            this.damp('backpressure', `${route.path}: upstream saturated`);
            res.writeHead(503);
            res.end();
            return;
        }

        const description =
            (route.descSegs ? asText(resolvePath(payload, route.descSegs)) : undefined) ??
            route.descDefault ??
            this.params.description;

        //fire-and-forget like every collector: 200 means "accepted by the
        //gateway"; delivery rides the bounded, throttled upstream path
        void this.sendPacket(formattedData, {
            site: route.site ?? this.params.site,
            ...(route.plugin !== undefined ? { plugin: route.plugin } : {}),
            description,
            rawData: this.params.keepRaw ? raw : null
        });
        res.writeHead(200);
        res.end('ok');
    }
}
