import { matchesSelector } from './rules.js';
const packetMs = (p, nowMs) => {
    const t = Date.parse(p.ts);
    return Number.isFinite(t) ? t : nowMs;
};
export class PatternMatcher {
    rules;
    onFire;
    state = new Map();
    connected = false;
    constructor(rules, onFire) {
        this.rules = rules;
        this.onFire = onFire;
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
    setConnected(connected) {
        this.connected = connected;
    }
    reconcile(packets, nowMs) {
        for (const p of packets) {
            const t = packetMs(p, nowMs);
            for (const r of this.rules) {
                if (!matchesSelector(r.selector, p))
                    continue;
                const st = this.state.get(r.name);
                if (st && (st.lastSeenMs === null || t > st.lastSeenMs)) {
                    st.lastSeenMs = t;
                    st.lastSeenTs = p.ts;
                }
            }
        }
    }
    observe(p, nowMs) {
        const t = packetMs(p, nowMs);
        for (const r of this.rules) {
            if (!matchesSelector(r.selector, p))
                continue;
            const st = this.state.get(r.name);
            if (!st)
                continue;
            if (st.lastSeenMs === null || t > st.lastSeenMs) {
                st.lastSeenMs = t;
                st.lastSeenTs = p.ts;
            }
            if (r.trigger.type === 'match') {
                this.onFire({ rule: r, reason: 'match', packet: p, count: 1 });
            }
            else if (r.trigger.type === 'silence') {
                if (st.firedSilence) {
                    st.firedSilence = false;
                    if (r.recover)
                        this.onFire({ rule: r, reason: 'recover', packet: p, count: 1 });
                }
            }
            else {
                st.hits.push(t);
                this.prune(st, r.trigger.windowMs, nowMs);
                if (st.hits.length > r.trigger.count)
                    st.hits.splice(0, st.hits.length - r.trigger.count);
                if (st.hits.length >= r.trigger.count && !st.firedFreq) {
                    st.firedFreq = true;
                    this.onFire({ rule: r, reason: 'match', packet: p, count: st.hits.length });
                }
            }
        }
    }
    evaluate(nowMs) {
        for (const r of this.rules) {
            const st = this.state.get(r.name);
            if (!st)
                continue;
            if (r.trigger.type === 'silence') {
                if (!this.connected || st.lastSeenMs === null || st.firedSilence)
                    continue;
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
            }
            else if (r.trigger.type === 'frequency') {
                this.prune(st, r.trigger.windowMs, nowMs);
                if (st.hits.length < r.trigger.count)
                    st.firedFreq = false;
            }
        }
    }
    prune(st, windowMs, nowMs) {
        const cutoff = nowMs - windowMs;
        while (st.hits.length && st.hits[0] < cutoff)
            st.hits.shift();
    }
}
