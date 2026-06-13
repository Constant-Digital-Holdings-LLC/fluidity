import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from '#@shared/modules/fluidityConfig.js';
import { isObject } from '#@shared/types.js';
import { DataCollector, extOpt } from '../collectors.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
const conf = await confFromFS();
const log = fetchLogger(conf);
const WEBHOOK_FLEET_DEFAULT_THROTTLE = 50;
const MAX_BODY_BYTES = 256 * 1024;
const DAMP_AFTER = 5;
const DAMP_EVERY = 100;
const resolvePath = (root, segs) => {
    let cur = root;
    for (const s of segs) {
        if (Array.isArray(cur)) {
            cur = cur[Number(s)];
        }
        else if (isObject(cur)) {
            cur = cur[s];
        }
        else {
            return undefined;
        }
    }
    return cur;
};
const asText = (v) => {
    if (v === undefined || v === null)
        return undefined;
    if (typeof v === 'string')
        return v;
    if (typeof v === 'number' || typeof v === 'boolean')
        return String(v);
    return JSON.stringify(v);
};
const parseSegs = (raw, where) => {
    if (typeof raw !== 'string' || !raw.length)
        throw new Error(`${where} must be a non-empty dot-path string`);
    const segs = raw.split('.');
    if (segs.some(s => !s.length))
        throw new Error(`${where}: "${raw}" has an empty path segment`);
    return segs;
};
const sha256 = (s) => createHash('sha256').update(s).digest();
export default class WebhookJsonCollector extends DataCollector {
    port;
    bindAddr;
    routes = new Map();
    tokenDigest;
    server;
    bound;
    constructor(params) {
        super({
            ...params,
            maxHttpsReqPerCollectorPerSec: params.maxHttpsReqPerCollectorPerSec ?? WEBHOOK_FLEET_DEFAULT_THROTTLE
        });
        const where = `webhookJson [${params.description}]`;
        const { port, bind } = params;
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error(`${where}: port must be an integer 0..65535`);
        }
        this.port = port;
        if (bind !== undefined && typeof bind !== 'string') {
            throw new Error(`${where}: bind must be an interface address string`);
        }
        this.bindAddr = bind;
        const eo = params.extendedOptions;
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
            if (!isObject(r))
                throw new Error(`${rw} must be an object`);
            const o = r;
            if (typeof o['path'] !== 'string' || !o['path'].startsWith('/')) {
                throw new Error(`${rw}.path must be a string starting with "/"`);
            }
            if (o['path'] === '/health')
                throw new Error(`${rw}.path: /health is reserved for the liveness probe`);
            if (this.routes.has(o['path']))
                throw new Error(`${rw}.path: duplicate route "${o['path']}"`);
            for (const k of ['site', 'plugin']) {
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
                site: o['site'],
                plugin: o['plugin'],
                descSegs: o['descriptionFrom'] !== undefined
                    ? parseSegs(o['descriptionFrom'], `${rw}.descriptionFrom`)
                    : null,
                descDefault: o['description'],
                fields
            });
        });
        this.server = http.createServer((req, res) => this.handle(req, res));
        this.bound = new Promise((resolve, reject) => {
            this.server.once('listening', () => resolve(this.server.address().port));
            this.server.once('error', reject);
        });
        this.bound.catch(() => undefined);
    }
    parseField(raw, fw) {
        if (!isObject(raw))
            throw new Error(`${fw} must be an object`);
        const o = raw;
        const hasFrom = o['from'] !== undefined;
        const hasConst = o['const'] !== undefined;
        if (hasFrom === hasConst) {
            throw new Error(`${fw} needs exactly one of "from" (a dot-path) or "const" (a literal)`);
        }
        if (hasConst && typeof o['const'] !== 'string')
            throw new Error(`${fw}.const must be a string`);
        for (const k of ['map', 'default', 'styleMap']) {
            if (hasConst && o[k] !== undefined)
                throw new Error(`${fw}.${k} only applies with "from"`);
        }
        let map = null;
        if (o['map'] !== undefined) {
            if (!isObject(o['map']))
                throw new Error(`${fw}.map must be an object of string values`);
            map = new Map();
            for (const [k, v] of Object.entries(o['map'])) {
                if (typeof v !== 'string')
                    throw new Error(`${fw}.map["${k}"] must be a string`);
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
        let styleMap = null;
        if (o['styleMap'] !== undefined) {
            if (!isObject(o['styleMap']))
                throw new Error(`${fw}.styleMap must be an object of numeric styles`);
            styleMap = new Map();
            for (const [k, v] of Object.entries(o['styleMap'])) {
                if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
                    throw new Error(`${fw}.styleMap["${k}"] must be a non-negative integer`);
                }
                styleMap.set(k, v);
            }
        }
        return {
            segs: hasFrom ? parseSegs(o['from'], `${fw}.from`) : null,
            constVal: hasConst ? o['const'] : null,
            map,
            mapDefault: o['default'],
            style,
            styleMap
        };
    }
    ready() {
        return this.bound;
    }
    start() {
        this.server.on('error', err => {
            log.error(`webhookJson [${this.params.description}]: server error on ` +
                `${this.bindAddr ?? '0.0.0.0'}:${this.port} - webhook ingest for this collector is offline: ${err.message}`);
        });
        this.server.on('listening', () => {
            const { address, port } = this.server.address();
            log.info(`started: ${this.params.plugin} [${this.params.description}] on http ${address}:${port}`);
            log.info(`webhookJson [${this.params.description}]: routes ${[...this.routes.keys()].join(', ')} ` +
                `(+ /health); upstream throttle ${this.maxPostsPerSec} posts/sec`);
            if (!this.tokenDigest) {
                log.info(`webhookJson [${this.params.description}]: open mode - no token required; ` +
                    `keep this port LAN-only`);
            }
            else {
                log.info(`webhookJson [${this.params.description}]: token mode - ` +
                    `bearer token required (Authorization or x-webhook-token)`);
            }
        });
        this.server.listen(this.port, this.bindAddr);
    }
    stop() {
        this.server.closeAllConnections();
        this.server.close();
    }
    format() {
        return null;
    }
    damp(reason, detail) {
        const n = this.noteDrop(reason);
        if (n <= DAMP_AFTER || n % DAMP_EVERY === 0) {
            log.debug(`webhookJson [${this.params.description}]: ${reason} #${n} - ${detail}`);
        }
        return n;
    }
    authorized(req) {
        if (!this.tokenDigest)
            return true;
        const auth = req.headers['authorization'];
        const presented = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-webhook-token'];
        if (typeof presented !== 'string' || !presented.length)
            return false;
        return timingSafeEqual(sha256(presented), this.tokenDigest);
    }
    handle(req, res) {
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
        req.on('data', (chunk) => {
            if (over)
                return;
            body += chunk;
            if (body.length > MAX_BODY_BYTES) {
                over = true;
                this.damp('oversize', `${pathname}: body exceeded ${MAX_BODY_BYTES} bytes`);
                res.writeHead(413);
                res.end();
                req.destroy();
            }
        });
        req.on('error', () => undefined);
        req.on('end', () => {
            if (over)
                return;
            let payload;
            try {
                payload = JSON.parse(body);
            }
            catch {
                this.damp('bad-json', `${pathname}: unparseable body (${body.length} bytes)`);
                res.writeHead(400);
                res.end('body is not JSON');
                return;
            }
            this.publish(route, payload, body, res);
        });
    }
    publish(route, payload, raw, res) {
        const formattedData = [];
        for (const f of route.fields) {
            if (f.constVal !== null) {
                formattedData.push({ suggestStyle: f.style, field: f.constVal, fieldType: 'STRING' });
                continue;
            }
            const extracted = asText(resolvePath(payload, f.segs));
            const text = extracted !== undefined ? (f.map?.get(extracted) ?? f.mapDefault ?? extracted) : f.mapDefault;
            if (text === undefined)
                continue;
            const style = (extracted !== undefined ? f.styleMap?.get(extracted) : undefined) ?? f.style;
            formattedData.push({ suggestStyle: style, field: text, fieldType: 'STRING' });
        }
        if (!formattedData.length) {
            this.damp('empty-mapping', `${route.path}: no fields extracted`);
            res.writeHead(200);
            res.end('ok (empty)');
            return;
        }
        if (this.upstreamSaturated) {
            this.damp('backpressure', `${route.path}: upstream saturated`);
            res.writeHead(503);
            res.end();
            return;
        }
        const description = (route.descSegs ? asText(resolvePath(payload, route.descSegs)) : undefined) ??
            route.descDefault ??
            this.params.description;
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
