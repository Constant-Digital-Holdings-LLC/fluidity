export const defaultSrsConfig = {
    linked: 0x0f,
    loopback: 0x01,
    interfaced: 0x1f,
    activePorts: [0, 6],
    heartbeatMs: 100000,
    rcvActProbability: 0.1,
    keyMinMs: 800,
    keyMaxMs: 8000,
    overGapMinMs: 400,
    overGapMaxMs: 4000,
    oversMin: 2,
    oversMax: 8,
    idleMinMs: 15000,
    idleMaxMs: 180000
};
const hex = (b) => (b & 0xff).toString(16).padStart(2, '0');
export const radioFrame = (cor, pl, rcv, dtmf, ptt) => `[${[cor, pl, rcv, dtmf, ptt].map(hex).join(' ')}]`;
export const portFrame = (c) => `{${[c.linked, c.loopback, 0, 0, 0, c.interfaced].map(hex).join(' ')}}`;
export function* srsLineStream(rng, config) {
    const c = { ...defaultSrsConfig, ...config };
    const between = (min, max) => min + Math.floor(rng() * (max - min + 1));
    let now = 0;
    let cor = 0;
    let rcv = 0;
    let hbRadioAt = c.heartbeatMs;
    let hbPortAt = between(2000, 10000);
    let keyed = false;
    let oversLeft = 0;
    let portIdx = 0;
    let nextQsoAt = between(2000, 20000);
    for (;;) {
        const qsoAt = nextQsoAt;
        let at = qsoAt;
        let kind = 'qso';
        if (hbRadioAt < at) {
            at = hbRadioAt;
            kind = 'hbRadio';
        }
        if (hbPortAt < at) {
            at = hbPortAt;
            kind = 'hbPort';
        }
        const afterMs = at - now;
        now = at;
        if (kind === 'hbRadio') {
            hbRadioAt += c.heartbeatMs;
            yield { afterMs, line: radioFrame(cor, 0, rcv, 0, 0) };
        }
        else if (kind === 'hbPort') {
            hbPortAt += c.heartbeatMs;
            yield { afterMs, line: portFrame(c) };
        }
        else if (!keyed) {
            if (oversLeft === 0) {
                oversLeft = between(c.oversMin, c.oversMax);
                portIdx = Math.floor(rng() * c.activePorts.length);
            }
            const port = c.activePorts[portIdx % c.activePorts.length] ?? 0;
            cor = (1 << port) & 0xff;
            rcv = rng() < c.rcvActProbability ? cor : 0;
            keyed = true;
            nextQsoAt = now + between(c.keyMinMs, c.keyMaxMs);
            yield { afterMs, line: radioFrame(cor, 0, rcv, 0, 0) };
        }
        else {
            cor = 0;
            rcv = 0;
            keyed = false;
            oversLeft--;
            portIdx++;
            nextQsoAt =
                now +
                    (oversLeft > 0 ? between(c.overGapMinMs, c.overGapMaxMs) : between(c.idleMinMs, c.idleMaxMs));
            yield { afterMs, line: radioFrame(0, 0, 0, 0, 0) };
        }
    }
}
//# sourceMappingURL=srsModel.js.map