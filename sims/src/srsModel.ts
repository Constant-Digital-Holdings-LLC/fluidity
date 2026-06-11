//Stateful model of an SRS HamStack controller's serial telemetry stream.
//
//Protocol per SRS Command List 0152, command C22A (serial port telemetry options):
//  bit 3: receive/transmit status streaming - "[cc pp rr dd tt]\r\n" where the five
//         hex bytes are per-port bitmasks for COR, PL, qualified receive, DTMF, PTT.
//         Sent every 100 seconds and whenever the state changes.
//  bit 4: port status streaming - "{ll oo dd ss gg ii}\r\n" - LINK, LOOPBACK,
//         DISABLED, SUDISABLED, SPLIT_GROUP, INTERFACED per-port bitmasks.
//         Sent every 100 seconds and whenever a command is executed.
//
//Behavior is tuned against production captures from https://f-y.io (2026-06-11):
//COR events are single-port and bursty (alternating "overs" between two ports of a
//linked system), releases emit an all-zero frame, port-state signatures are
//per-site constants with LINK a subset of INTERFACED.

import { Rng } from './prng.js';

export interface TimedLine {
    afterMs: number;
    line: string;
}

export interface SrsSimConfig {
    linked: number;
    loopback: number;
    interfaced: number;
    activePorts: number[];
    heartbeatMs: number;
    rcvActProbability: number;
    keyMinMs: number;
    keyMaxMs: number;
    overGapMinMs: number;
    overGapMaxMs: number;
    oversMin: number;
    oversMax: number;
    idleMinMs: number;
    idleMaxMs: number;
}

//defaults mirror an observed real site: {0f 01 00 00 00 1f} with traffic on ports 0 and 6
export const defaultSrsConfig: SrsSimConfig = {
    linked: 0x0f,
    loopback: 0x01,
    interfaced: 0x1f,
    activePorts: [0, 6],
    heartbeatMs: 100_000,
    rcvActProbability: 0.1,
    keyMinMs: 800,
    keyMaxMs: 8000,
    overGapMinMs: 400,
    overGapMaxMs: 4000,
    oversMin: 2,
    oversMax: 8,
    idleMinMs: 15_000,
    idleMaxMs: 180_000
};

const hex = (b: number): string => (b & 0xff).toString(16).padStart(2, '0');

export const radioFrame = (cor: number, pl: number, rcv: number, dtmf: number, ptt: number): string =>
    `[${[cor, pl, rcv, dtmf, ptt].map(hex).join(' ')}]`;

export const portFrame = (c: Pick<SrsSimConfig, 'linked' | 'loopback' | 'interfaced'>): string =>
    `{${[c.linked, c.loopback, 0, 0, 0, c.interfaced].map(hex).join(' ')}}`;

export function* srsLineStream(rng: Rng, config?: Partial<SrsSimConfig>): Generator<TimedLine, never, unknown> {
    const c: SrsSimConfig = { ...defaultSrsConfig, ...config };
    const between = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

    let now = 0;
    let cor = 0;
    let rcv = 0;

    let hbRadioAt = c.heartbeatMs;
    let hbPortAt = between(2000, 10_000); //land mid-cycle, but show port states soon after connect

    //QSO state: a conversation is a series of "overs" alternating between active ports
    let keyed = false;
    let oversLeft = 0;
    let portIdx = 0;
    let nextQsoAt = between(2000, 20_000);

    for (;;) {
        const qsoAt = nextQsoAt;
        let at = qsoAt;
        let kind: 'qso' | 'hbRadio' | 'hbPort' = 'qso';

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
        } else if (kind === 'hbPort') {
            hbPortAt += c.heartbeatMs;
            yield { afterMs, line: portFrame(c) };
        } else if (!keyed) {
            //key up: start of an over (and possibly of a new QSO)
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
        } else {
            //key release: state change back to zero is streamed too
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
