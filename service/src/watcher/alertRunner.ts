//AlertRunner (W3): turns Fire events into bounded, rate-limited child-process
//executions. This is where the anti-fork-bomb and anti-message-bomb
//protections live. spawn and the clock are injectable so the protections are
//unit-testable; the default spawn runs a real program with shell:false.
//
//Security model: the program is operator-configured (trusted), but the packet
//content reaching it is NOT. It is only ever delivered as data - stdin, a
//FLU_* env, and a static argv - never interpolated into a shell command
//(shell:false), so a field like "$(rm -rf /)" is inert. The child also gets a
//minimal env (PATH + FLU_* only); the server's TLS/API-key env is never
//inherited.

import { spawn as nodeSpawn } from 'node:child_process';
import { FluidityPacket } from '#@shared/types.js';
import { ParsedRule, joinedText } from './rules.js';
import { FireEvent } from './matcher.js';

export interface SpawnedChild {
    writeStdin(s: string): void; //write + end, swallowing EPIPE if the child already exited
    onExit(cb: (code: number | null) => void): void;
    onError(cb: (e: Error) => void): void;
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}
export type SpawnFn = (cmd: string, args: string[], env: Record<string, string>) => SpawnedChild;

export interface RunnerLimits {
    maxConcurrent: number; //hard ceiling on simultaneous children (the fork-bomb guard)
    queueCap: number; //pending jobs beyond the cap are shed (and counted)
    execTimeoutMs: number; //a child past this is killed (can't wedge a slot)
    failureThreshold: number; //consecutive failures that open a rule's circuit
    circuitMs: number; //how long a tripped rule is parked
}

export const DEFAULT_LIMITS: RunnerLimits = {
    maxConcurrent: 4,
    queueCap: 64,
    execTimeoutMs: 10_000,
    failureThreshold: 5,
    circuitMs: 300_000
};

export interface RunnerDeps {
    spawn?: SpawnFn;
    now?: () => number;
    log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
    dryRun?: boolean; //log what would fire, never exec - for testing rules safely
}

export interface RunnerStats {
    fired: number;
    coalesced: number;
    queueShed: number;
    rateShed: number;
    circuitShed: number;
    killed: number;
    failed: number;
    completed: number;
}

interface RuleRt {
    lastFiredMs: number;
    pendingCount: number;
    pendingEvent: FireEvent | null;
    tokens: number;
    tokenRefilledMs: number;
    failures: number;
    circuitUntilMs: number;
}

interface Job {
    rule: ParsedRule;
    args: string[];
    env: Record<string, string>;
    message: string;
}

interface Running {
    child: SpawnedChild;
    timer: NodeJS.Timeout;
    killed: boolean;
    ruleName: string;
}

const HOUR_MS = 3_600_000;

const humanMs = (ms: number): string =>
    ms % HOUR_MS === 0 && ms >= HOUR_MS
        ? `${ms / HOUR_MS}h`
        : ms % 60_000 === 0 && ms >= 60_000
          ? `${ms / 60_000}m`
          : `${Math.round(ms / 1000)}s`;

const realSpawn: SpawnFn = (cmd, args, env) => {
    const c = nodeSpawn(cmd, args, { env, stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    return {
        writeStdin(s): void {
            if (!c.stdin) return;
            c.stdin.on('error', () => undefined); //child may have exited before reading
            c.stdin.write(s);
            c.stdin.end();
        },
        onExit(cb): void {
            c.on('exit', code => cb(code));
        },
        onError(cb): void {
            c.on('error', cb);
        },
        kill(signal): void {
            c.kill(signal);
        }
    };
};

export class AlertRunner {
    private readonly spawn: SpawnFn;
    private readonly now: () => number;
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;
    private readonly dryRun: boolean;
    private readonly rt = new Map<string, RuleRt>();
    private readonly queue: Job[] = [];
    private readonly running = new Set<Running>();
    private stopped = false;
    readonly stats: RunnerStats = {
        fired: 0,
        coalesced: 0,
        queueShed: 0,
        rateShed: 0,
        circuitShed: 0,
        killed: 0,
        failed: 0,
        completed: 0
    };

    constructor(
        private readonly limits: RunnerLimits = DEFAULT_LIMITS,
        deps: RunnerDeps = {}
    ) {
        this.spawn = deps.spawn ?? realSpawn;
        this.now = deps.now ?? Date.now;
        this.log = deps.log ?? ((): void => undefined);
        this.dryRun = deps.dryRun ?? false;
    }

    private rtFor(rule: ParsedRule): RuleRt {
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

    private takeToken(rule: ParsedRule, s: RuleRt, now: number): boolean {
        const refill = ((now - s.tokenRefilledMs) / HOUR_MS) * rule.maxPerHour;
        s.tokens = Math.min(rule.maxPerHour, s.tokens + refill);
        s.tokenRefilledMs = now;
        if (s.tokens < 1) return false;
        s.tokens -= 1;
        return true;
    }

    fire(event: FireEvent): void {
        if (this.stopped) return;
        const rule = event.rule;
        const s = this.rtFor(rule);
        const now = this.now();

        if (now < s.circuitUntilMs) {
            this.stats.circuitShed++;
            return;
        }
        //within cooldown: accumulate, the post-cooldown flush (tick) summarizes
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

    //flush rules whose cooldown elapsed while matches accumulated, and is a
    //no-op otherwise. The app calls this on a steady interval.
    tick(): void {
        if (this.stopped) return;
        const now = this.now();
        for (const [, s] of this.rt) {
            if (s.pendingCount <= 0 || !s.pendingEvent) continue;
            const rule = s.pendingEvent.rule;
            if (now - s.lastFiredMs < rule.cooldownMs) continue;
            if (now < s.circuitUntilMs) {
                s.pendingCount = 0;
                s.pendingEvent = null;
                continue;
            }
            if (!this.takeToken(rule, s, now)) continue; //keep pending; try next tick
            const event = s.pendingEvent;
            const count = s.pendingCount;
            s.lastFiredMs = now;
            s.pendingCount = 0;
            s.pendingEvent = null;
            this.enqueue(this.buildJob(event, count));
        }
    }

    private enqueue(job: Job): void {
        if (this.running.size < this.limits.maxConcurrent) {
            this.run(job);
        } else if (this.queue.length < this.limits.queueCap) {
            this.queue.push(job);
        } else {
            this.stats.queueShed++;
            this.log('warn', `alert "${job.rule.name}": exec queue full (${this.limits.queueCap}), shedding`);
        }
    }

    private run(job: Job): void {
        this.stats.fired++;
        if (this.dryRun) {
            this.stats.completed++;
            this.log('info', `[dryRun] would exec ${job.rule.exec} ${job.args.join(' ')} :: ${job.message}`);
            return;
        }
        let child: SpawnedChild;
        try {
            child = this.spawn(job.rule.exec, job.args, job.env);
        } catch (e) {
            this.recordFailure(job.rule, `spawn failed: ${(e as Error).message}`);
            this.pump();
            return;
        }
        const entry: Running = {
            child,
            timer: null as unknown as NodeJS.Timeout,
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
            if (!this.running.has(entry)) return;
            clearTimeout(entry.timer);
            this.running.delete(entry);
            this.recordFailure(job.rule, `exec error: ${e.message}`);
            this.pump();
        });
        child.onExit(code => {
            if (!this.running.has(entry)) return;
            clearTimeout(entry.timer);
            this.running.delete(entry);
            if (entry.killed) {
                this.stats.killed++;
                this.recordFailure(job.rule, `killed after ${this.limits.execTimeoutMs}ms timeout`);
            } else if (code !== 0) {
                this.recordFailure(job.rule, `exited ${code ?? 'null'}`);
            } else {
                this.stats.completed++;
                const s = this.rt.get(job.rule.name);
                if (s) s.failures = 0; //a clean run resets the breaker
            }
            this.pump();
        });

        child.writeStdin(job.message);
    }

    private pump(): void {
        if (this.stopped) return;
        while (this.running.size < this.limits.maxConcurrent && this.queue.length) {
            const next = this.queue.shift();
            if (next) this.run(next);
        }
    }

    private recordFailure(rule: ParsedRule, why: string): void {
        this.stats.failed++;
        const s = this.rtFor(rule);
        s.failures++;
        this.log('warn', `alert "${rule.name}" ${why} (failure ${s.failures}/${this.limits.failureThreshold})`);
        if (s.failures >= this.limits.failureThreshold) {
            s.circuitUntilMs = this.now() + this.limits.circuitMs;
            s.failures = 0;
            this.log(
                'error',
                `alert "${rule.name}" circuit open for ${humanMs(this.limits.circuitMs)} (too many failures)`
            );
        }
    }

    private buildJob(event: FireEvent, count: number): Job {
        const rule = event.rule;
        const vars = templateVars(event, count);
        const message = rule.format === 'json' ? jsonPayload(event, count) : renderTemplate(rule.message, vars);
        return { rule, args: rule.args, env: cleanEnv(vars), message };
    }

    stop(): void {
        this.stopped = true;
        for (const e of this.running) {
            clearTimeout(e.timer);
            e.child.kill('SIGKILL');
        }
        this.running.clear();
        this.queue.length = 0;
    }
}

//--- payload construction (data only; never a shell string) -----------------
type Vars = Record<string, string>;

const fieldText = (p: FluidityPacket): string => joinedText(p);

const templateVars = (e: FireEvent, count: number): Vars => {
    const rule = e.rule;
    const v: Vars = {
        rule: rule.name,
        reason: e.reason,
        count: String(count),
        window: humanMs(rule.trigger.windowMs),
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
    } else {
        v['site'] = rule.selector.site ?? '';
        v['plugin'] = rule.selector.plugin ?? '';
        v['ts'] = e.lastSeenTs ?? '';
    }
    return v;
};

const renderTemplate = (tmpl: string, vars: Vars): string =>
    tmpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');

const jsonPayload = (e: FireEvent, count: number): string =>
    JSON.stringify(
        e.packet
            ? { rule: e.rule.name, reason: e.reason, count, packet: e.packet }
            : { rule: e.rule.name, reason: e.reason, count, silenceSec: e.silenceSec, lastSeen: e.lastSeenTs }
    );

//minimal, clean env: PATH (so the program can find its tools) + FLU_* only.
//The server/watcher process env (TLS keys, API keys) is deliberately NOT
//inherited.
const cleanEnv = (vars: Vars): Record<string, string> => ({
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
