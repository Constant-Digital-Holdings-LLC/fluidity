//PatternMatcher (W2): pure, time injected by the caller (no internal timers),
//so windows/silence are fully deterministic in tests. Holds per-rule state,
//consumes packets, and emits Fire events; the AlertRunner does the exec'ing.
//
//Absence is connection-aware: while the SSE feed is "blind" (disconnected) we
//do NOT fire silence (a dropped pipe is not a dead site), and on reconnect the
//caller reconciles last-seen from /FIFO. Silence is judged against the
//packet's own ts, not local arrival, so delivery jitter can't trip it.

import { FluidityPacket } from '#@shared/types.js';
import { ParsedRule, FireReason, matchesSelector } from './rules.js';

export interface FireEvent {
    rule: ParsedRule;
    reason: FireReason;
    packet?: FluidityPacket;
    count: number; //matches represented (1 for silence/recover, window count for a storm)
    silenceSec?: number;
    lastSeenTs?: string; //the last matching packet's ts (for silence/recover context)
}

interface RuleState {
    lastSeenMs: number | null; //by packet ts
    lastSeenTs: string | null;
    firedSilence: boolean;
    hits: number[]; //frequency: matching packet times (by ts), within the window
    firedFreq: boolean;
}

//a packet's effective time: its own ts, falling back to wall time if unparseable
const packetMs = (p: FluidityPacket, nowMs: number): number => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) ? t : nowMs;
};

export class PatternMatcher {
    private readonly state = new Map<string, RuleState>();
    private connected = false;

    constructor(
        private readonly rules: ParsedRule[],
        private readonly onFire: (e: FireEvent) => void
    ) {
        for (const r of rules) {
            this.state.set(r.name, {
                lastSeenMs: null,
                lastSeenTs: null,
                firedSilence: false,
                hits: [],
                firedFreq: false
            });
        }
    }

    //connection state gates silence firing. The caller reconciles via /FIFO
    //BEFORE flipping back to connected, so last-seen reflects reality.
    setConnected(connected: boolean): void {
        this.connected = connected;
    }

    //seed last-seen from a /FIFO snapshot without firing (startup + reconnect).
    //Frequency windows are intentionally NOT backfilled - that would let a
    //reconnect replay a historical burst as a fresh storm.
    reconcile(packets: FluidityPacket[], nowMs: number): void {
        for (const p of packets) {
            const t = packetMs(p, nowMs);
            for (const r of this.rules) {
                if (!matchesSelector(r.selector, p)) continue;
                const st = this.state.get(r.name);
                if (st && (st.lastSeenMs === null || t > st.lastSeenMs)) {
                    st.lastSeenMs = t;
                    st.lastSeenTs = p.ts;
                }
            }
        }
    }

    //a live packet: update last-seen, fire a match rule per packet, recover a
    //silenced rule, and edge-fire a frequency rule when its window first
    //reaches the threshold
    observe(p: FluidityPacket, nowMs: number): void {
        const t = packetMs(p, nowMs);
        for (const r of this.rules) {
            if (!matchesSelector(r.selector, p)) continue;
            const st = this.state.get(r.name);
            if (!st) continue;

            if (st.lastSeenMs === null || t > st.lastSeenMs) {
                st.lastSeenMs = t;
                st.lastSeenTs = p.ts;
            }

            if (r.trigger.type === 'match') {
                //per-packet routing: every matching packet fires; rate safety
                //is the runner's job (cooldown/maxPerHour/queue/circuit)
                this.onFire({ rule: r, reason: 'match', packet: p, count: 1 });
            } else if (r.trigger.type === 'silence') {
                if (st.firedSilence) {
                    st.firedSilence = false;
                    if (r.recover) this.onFire({ rule: r, reason: 'recover', packet: p, count: 1 });
                }
            } else {
                st.hits.push(t);
                this.prune(st, r.trigger.windowMs, nowMs);
                //only the count within the window matters, so keep at most
                //`count` timestamps - a sustained storm on a long window would
                //otherwise grow this array without bound (rate x window)
                if (st.hits.length > r.trigger.count) st.hits.splice(0, st.hits.length - r.trigger.count);
                if (st.hits.length >= r.trigger.count && !st.firedFreq) {
                    st.firedFreq = true;
                    this.onFire({ rule: r, reason: 'match', packet: p, count: st.hits.length });
                }
            }
        }
    }

    //periodic check: fire silence for rules quiet past their window (only while
    //connected), and re-arm frequency rules whose window has drained.
    evaluate(nowMs: number): void {
        for (const r of this.rules) {
            const st = this.state.get(r.name);
            if (!st) continue;

            if (r.trigger.type === 'silence') {
                if (!this.connected || st.lastSeenMs === null || st.firedSilence) continue;
                if (nowMs - st.lastSeenMs >= r.trigger.windowMs) {
                    st.firedSilence = true;
                    this.onFire({
                        rule: r,
                        reason: 'silence',
                        count: 1,
                        silenceSec: Math.round((nowMs - st.lastSeenMs) / 1000),
                        ...(st.lastSeenTs ? { lastSeenTs: st.lastSeenTs } : {})
                    });
                }
            } else if (r.trigger.type === 'frequency') {
                this.prune(st, r.trigger.windowMs, nowMs);
                if (st.hits.length < r.trigger.count) st.firedFreq = false;
            }
        }
    }

    private prune(st: RuleState, windowMs: number, nowMs: number): void {
        const cutoff = nowMs - windowMs;
        while (st.hits.length && (st.hits[0] as number) < cutoff) st.hits.shift();
    }
}
