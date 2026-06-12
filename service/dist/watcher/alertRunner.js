import { spawn as nodeSpawn } from 'node:child_process';
import { joinedText } from './rules.js';
export const DEFAULT_LIMITS = {
    maxConcurrent: 4,
    queueCap: 64,
    execTimeoutMs: 10_000,
    failureThreshold: 5,
    circuitMs: 300_000
};
const HOUR_MS = 3_600_000;
const humanMs = (ms) => ms % HOUR_MS === 0 && ms >= HOUR_MS
    ? `${ms / HOUR_MS}h`
    : ms % 60_000 === 0 && ms >= 60_000
        ? `${ms / 60_000}m`
        : `${Math.round(ms / 1000)}s`;
const realSpawn = (cmd, args, env) => {
    const c = nodeSpawn(cmd, args, { env, stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    return {
        writeStdin(s) {
            if (!c.stdin)
                return;
            c.stdin.on('error', () => undefined);
            c.stdin.write(s);
            c.stdin.end();
        },
        onExit(cb) {
            c.on('exit', code => cb(code));
        },
        onError(cb) {
            c.on('error', cb);
        },
        kill(signal) {
            c.kill(signal);
        }
    };
};
export class AlertRunner {
    limits;
    spawn;
    now;
    log;
    rt = new Map();
    queue = [];
    running = new Set();
    stopped = false;
    stats = {
        fired: 0,
        coalesced: 0,
        queueShed: 0,
        rateShed: 0,
        circuitShed: 0,
        killed: 0,
        failed: 0,
        completed: 0
    };
    constructor(limits = DEFAULT_LIMITS, deps = {}) {
        this.limits = limits;
        this.spawn = deps.spawn ?? realSpawn;
        this.now = deps.now ?? Date.now;
        this.log = deps.log ?? (() => undefined);
    }
    rtFor(rule) {
        let s = this.rt.get(rule.name);
        if (!s) {
            s = {
                lastFiredMs: -Infinity,
                pendingCount: 0,
                pendingEvent: null,
                tokens: rule.maxPerHour,
                tokenRefilledMs: this.now(),
                failures: 0,
                circuitUntilMs: 0
            };
            this.rt.set(rule.name, s);
        }
        return s;
    }
    takeToken(rule, s, now) {
        const refill = ((now - s.tokenRefilledMs) / HOUR_MS) * rule.maxPerHour;
        s.tokens = Math.min(rule.maxPerHour, s.tokens + refill);
        s.tokenRefilledMs = now;
        if (s.tokens < 1)
            return false;
        s.tokens -= 1;
        return true;
    }
    fire(event) {
        if (this.stopped)
            return;
        const rule = event.rule;
        const s = this.rtFor(rule);
        const now = this.now();
        if (now < s.circuitUntilMs) {
            this.stats.circuitShed++;
            return;
        }
        if (now - s.lastFiredMs < rule.cooldownMs) {
            s.pendingCount += event.count;
            s.pendingEvent = event;
            this.stats.coalesced++;
            return;
        }
        if (!this.takeToken(rule, s, now)) {
            this.stats.rateShed++;
            return;
        }
        s.lastFiredMs = now;
        const count = event.count + s.pendingCount;
        s.pendingCount = 0;
        s.pendingEvent = null;
        this.enqueue(this.buildJob(event, count));
    }
    tick() {
        if (this.stopped)
            return;
        const now = this.now();
        for (const [, s] of this.rt) {
            if (s.pendingCount <= 0 || !s.pendingEvent)
                continue;
            const rule = s.pendingEvent.rule;
            if (now - s.lastFiredMs < rule.cooldownMs)
                continue;
            if (now < s.circuitUntilMs) {
                s.pendingCount = 0;
                s.pendingEvent = null;
                continue;
            }
            if (!this.takeToken(rule, s, now))
                continue;
            const event = s.pendingEvent;
            const count = s.pendingCount;
            s.lastFiredMs = now;
            s.pendingCount = 0;
            s.pendingEvent = null;
            this.enqueue(this.buildJob(event, count));
        }
    }
    enqueue(job) {
        if (this.running.size < this.limits.maxConcurrent) {
            this.run(job);
        }
        else if (this.queue.length < this.limits.queueCap) {
            this.queue.push(job);
        }
        else {
            this.stats.queueShed++;
            this.log('warn', `alert "${job.rule.name}": exec queue full (${this.limits.queueCap}), shedding`);
        }
    }
    run(job) {
        this.stats.fired++;
        let child;
        try {
            child = this.spawn(job.rule.exec, job.args, job.env);
        }
        catch (e) {
            this.recordFailure(job.rule, `spawn failed: ${e.message}`);
            this.pump();
            return;
        }
        const entry = {
            child,
            timer: null,
            killed: false,
            ruleName: job.rule.name
        };
        entry.timer = setTimeout(() => {
            entry.killed = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
        }, this.limits.execTimeoutMs);
        entry.timer.unref?.();
        this.running.add(entry);
        child.onError(e => {
            if (!this.running.has(entry))
                return;
            clearTimeout(entry.timer);
            this.running.delete(entry);
            this.recordFailure(job.rule, `exec error: ${e.message}`);
            this.pump();
        });
        child.onExit(code => {
            if (!this.running.has(entry))
                return;
            clearTimeout(entry.timer);
            this.running.delete(entry);
            if (entry.killed) {
                this.stats.killed++;
                this.recordFailure(job.rule, `killed after ${this.limits.execTimeoutMs}ms timeout`);
            }
            else if (code !== 0) {
                this.recordFailure(job.rule, `exited ${code ?? 'null'}`);
            }
            else {
                this.stats.completed++;
                const s = this.rt.get(job.rule.name);
                if (s)
                    s.failures = 0;
            }
            this.pump();
        });
        child.writeStdin(job.message);
    }
    pump() {
        if (this.stopped)
            return;
        while (this.running.size < this.limits.maxConcurrent && this.queue.length) {
            const next = this.queue.shift();
            if (next)
                this.run(next);
        }
    }
    recordFailure(rule, why) {
        this.stats.failed++;
        const s = this.rtFor(rule);
        s.failures++;
        this.log('warn', `alert "${rule.name}" ${why} (failure ${s.failures}/${this.limits.failureThreshold})`);
        if (s.failures >= this.limits.failureThreshold) {
            s.circuitUntilMs = this.now() + this.limits.circuitMs;
            s.failures = 0;
            this.log('error', `alert "${rule.name}" circuit open for ${humanMs(this.limits.circuitMs)} (too many failures)`);
        }
    }
    buildJob(event, count) {
        const rule = event.rule;
        const vars = templateVars(event, count);
        const message = rule.format === 'json' ? jsonPayload(event, count) : renderTemplate(rule.message, vars);
        return { rule, args: rule.args, env: cleanEnv(vars), message };
    }
    stop() {
        this.stopped = true;
        for (const e of this.running) {
            clearTimeout(e.timer);
            e.child.kill('SIGKILL');
        }
        this.running.clear();
        this.queue.length = 0;
    }
}
const fieldText = (p) => joinedText(p);
const templateVars = (e, count) => {
    const rule = e.rule;
    const v = {
        rule: rule.name,
        reason: e.reason,
        count: String(count),
        window: rule.trigger.type === 'silence' ? humanMs(rule.trigger.windowMs) : humanMs(rule.trigger.windowMs),
        site: '',
        plugin: '',
        description: '',
        ts: '',
        seq: '',
        text: '',
        raw: '',
        silenceSec: e.silenceSec !== undefined ? String(e.silenceSec) : '',
        lastSeen: e.lastSeenTs ?? ''
    };
    if (e.packet) {
        v['site'] = e.packet.site;
        v['plugin'] = e.packet.plugin;
        v['description'] = e.packet.description;
        v['ts'] = e.packet.ts;
        v['seq'] = e.packet.seq !== undefined ? String(e.packet.seq) : '';
        v['text'] = fieldText(e.packet);
        v['raw'] = e.packet.rawData ?? '';
    }
    else {
        v['site'] = rule.selector.site ?? '';
        v['plugin'] = rule.selector.plugin ?? '';
        v['ts'] = e.lastSeenTs ?? '';
    }
    return v;
};
const renderTemplate = (tmpl, vars) => tmpl.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? '');
const jsonPayload = (e, count) => JSON.stringify(e.packet
    ? { rule: e.rule.name, reason: e.reason, count, packet: e.packet }
    : { rule: e.rule.name, reason: e.reason, count, silenceSec: e.silenceSec, lastSeen: e.lastSeenTs });
const cleanEnv = (vars) => ({
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    FLU_RULE: vars['rule'] ?? '',
    FLU_REASON: vars['reason'] ?? '',
    FLU_COUNT: vars['count'] ?? '',
    FLU_SITE: vars['site'] ?? '',
    FLU_PLUGIN: vars['plugin'] ?? '',
    FLU_DESCRIPTION: vars['description'] ?? '',
    FLU_TS: vars['ts'] ?? '',
    FLU_SEQ: vars['seq'] ?? '',
    FLU_TEXT: vars['text'] ?? '',
    FLU_RAW: vars['raw'] ?? '',
    FLU_SILENCE_SEC: vars['silenceSec'] ?? ''
});
