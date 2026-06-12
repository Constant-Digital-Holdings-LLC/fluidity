import { accessSync, constants } from 'node:fs';
import { fetchLogger } from '#@shared/modules/logger.js';
import { confFromFS } from './watcherConfig.js';
import { parseRules } from './rules.js';
import { PatternMatcher } from './matcher.js';
import { AlertRunner, DEFAULT_LIMITS } from './alertRunner.js';
import { follow } from './sseFollow.js';
process.on('unhandledRejection', reason => {
    console.error(reason);
    process.exit(1);
});
process.on('uncaughtException', reason => {
    console.error(reason);
    process.exit(1);
});
const conf = await confFromFS();
const log = fetchLogger(conf);
const checkExec = (path) => {
    try {
        accessSync(path, constants.X_OK);
    }
    catch {
        throw new Error(`watcher: alert exec "${path}" is missing or not executable`);
    }
};
const { rules, skipped } = parseRules(conf.alerts, { checkExec });
if (skipped.length)
    log.info(`watcher: ${skipped.length} alert(s) disabled in config: ${skipped.join(', ')}`);
if (!rules.length)
    log.warn('watcher: no enabled alert rules - subscribing but nothing is armed');
const limits = { ...DEFAULT_LIMITS, ...(conf.limits ?? {}) };
const runner = new AlertRunner(limits, { log: (level, msg) => log[level](msg) });
const matcher = new PatternMatcher(rules, event => runner.fire(event));
const base = new URL(conf.watch);
const handle = follow(base, { insecure: conf.insecure === true }, {
    onReconcile: packets => matcher.reconcile(packets, Date.now()),
    onConnected: () => {
        matcher.setConnected(true);
        log.info(`watcher: connected to ${base.origin}`);
    },
    onDisconnected: detail => {
        matcher.setConnected(false);
        log.warn(`watcher: lost connection to ${base.origin} (${detail ?? 'unknown'}) - absence checks paused`);
    },
    onPacket: packet => matcher.observe(packet, Date.now())
});
const evalMs = typeof conf.evalIntervalMs === 'number' && conf.evalIntervalMs >= 100 ? conf.evalIntervalMs : 1000;
const ticker = setInterval(() => {
    const now = Date.now();
    matcher.evaluate(now);
    runner.tick();
}, evalMs);
log.info(`watcher: ${rules.length} rule(s) armed, watching ${base.origin}, evaluating every ${evalMs}ms`);
const shutdown = () => {
    clearInterval(ticker);
    handle.stop();
    runner.stop();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
