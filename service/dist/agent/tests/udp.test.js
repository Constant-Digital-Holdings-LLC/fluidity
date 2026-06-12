import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '#@sims/prng.js';
import { siphash24, macEqual } from '#@sims/siphash.js';
import { FLU_MAGIC, FLU_HEADER_BYTES, FLU_FIELD_BYTES, FLU_FULL_BYTES, FLU_MAC_BYTES, FLU_MAX_DATAGRAM, FLU_F_TS, FLU_F_MAC, decodeFluPacket, encodeFluPacket } from '../modules/udpCodec.js';
const decodeOk = (buf) => {
    const r = decodeFluPacket(buf);
    assert.ok(r.ok, `expected decode, got drop: ${r.ok ? '' : r.reason}`);
    return r.packet;
};
const reasonOf = (buf) => {
    const r = decodeFluPacket(buf);
    assert.ok(!r.ok, 'expected a drop, packet decoded');
    return r.reason;
};
void test('udpCodec: compact form round-trips every field', () => {
    const buf = encodeFluPacket({
        site: 'greenhouse',
        plugin: 'm5-env',
        description: 'soil probe',
        deviceSeq: 4242,
        fields: [
            { style: 2, text: 'temp 21.4C' },
            { style: 7, text: 'rh 64%' }
        ]
    });
    assert.equal(buf.length, FLU_HEADER_BYTES + 2 * FLU_FIELD_BYTES);
    const p = decodeOk(buf);
    assert.equal(p.site, 'greenhouse');
    assert.equal(p.plugin, 'm5-env');
    assert.equal(p.description, 'soil probe');
    assert.equal(p.deviceSeq, 4242);
    assert.equal(p.tsEpochMs, null, 'no FLU_F_TS: device is clockless');
    assert.equal(p.hasMac, false);
    assert.deepEqual(p.fields, [
        { style: 2, text: 'temp 21.4C' },
        { style: 7, text: 'rh 64%' }
    ]);
});
void test('udpCodec: wire layout is the documented packed struct (§3.1)', () => {
    const buf = encodeFluPacket({
        site: 'gate-1',
        plugin: 'avr-door',
        deviceSeq: 0x0201,
        tsEpochSec: 0x04030201,
        fields: [{ style: 5, text: 'open' }]
    });
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'FLU1', 'magic bytes');
    assert.equal(buf.readUInt32LE(0), FLU_MAGIC);
    assert.equal(buf[4], 1, 'version');
    assert.equal(buf[5], FLU_F_TS, 'flags');
    assert.deepEqual([buf[6], buf[7]], [0x01, 0x02], 'device_seq little-endian');
    assert.deepEqual([buf[8], buf[9], buf[10], buf[11]], [0x01, 0x02, 0x03, 0x04], 'ts_epoch little-endian');
    assert.equal(buf.subarray(12, 12 + 6).toString('latin1'), 'gate-1');
    assert.equal(buf[18], 0, 'site NUL-padded');
    assert.equal(buf.subarray(28, 28 + 8).toString('latin1'), 'avr-door');
    assert.equal(buf[FLU_HEADER_BYTES - 1], 1, 'field_count at offset 60');
    assert.equal(buf[FLU_HEADER_BYTES], 5, 'fields[0].style at offset 61');
    assert.equal(buf[FLU_HEADER_BYTES + 1], 0, 'fields[0].reserved');
    assert.equal(buf.subarray(FLU_HEADER_BYTES + 2, FLU_HEADER_BYTES + 6).toString('latin1'), 'open');
});
void test('udpCodec: full struct (firmware sizeof) decodes, surplus field slots ignored', () => {
    const buf = encodeFluPacket({
        site: 'shed',
        plugin: 'm5-env',
        fields: [{ style: 1, text: 'heartbeat' }],
        full: true
    });
    assert.equal(buf.length, FLU_FULL_BYTES);
    const p = decodeOk(buf);
    assert.equal(p.fields.length, 1, 'field_count governs, not buffer capacity');
    assert.deepEqual(p.fields[0], { style: 1, text: 'heartbeat' });
});
void test('udpCodec: device timestamp surfaces in ms only when FLU_F_TS is set', () => {
    const withTs = encodeFluPacket({
        site: 's',
        plugin: 'p',
        tsEpochSec: 1_765_000_000,
        fields: [{ style: 0, text: 'x' }]
    });
    assert.equal(decodeOk(withTs).tsEpochMs, 1_765_000_000_000);
    const noTs = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    noTs.writeUInt32LE(1_765_000_000, 8);
    assert.equal(decodeOk(noTs).tsEpochMs, null);
});
void test('udpCodec: names and field text may occupy their full width with no NUL', () => {
    const site16 = 'abcdefghijklmnop';
    const text40 = 'x'.repeat(40);
    const p = decodeOk(encodeFluPacket({ site: site16, plugin: 'p', fields: [{ style: 0, text: text40 }] }));
    assert.equal(p.site, site16);
    assert.equal(p.fields[0]?.text, text40);
});
void test('udpCodec: decoding stops at the first NUL; stale bytes beyond it are invisible', () => {
    const buf = encodeFluPacket({ site: 'ab', plugin: 'p', fields: [{ style: 0, text: 'hi' }] });
    buf.write('Xleftover', 15, 'latin1');
    assert.equal(decodeOk(buf).site, 'ab');
});
void test('udpCodec: control characters are stripped, whitespace trimmed', () => {
    const buf = encodeFluPacket({ site: ' kk6\x01beb\r\n', plugin: 'p', fields: [{ style: 0, text: '\ttick\x7f ' }] });
    const p = decodeOk(buf);
    assert.equal(p.site, 'kk6beb');
    assert.equal(p.fields[0]?.text, 'tick');
});
void test('udpCodec: reserved field byte is tolerated and ignored (v2 headroom)', () => {
    const buf = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    buf[FLU_HEADER_BYTES + 1] = 0xee;
    assert.ok(decodeFluPacket(buf).ok);
});
void test('udpCodec: MAC flag changes length accounting; trailer is surfaced not verified (U1)', () => {
    const unsigned = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    const flagOnly = Buffer.from(unsigned);
    flagOnly[5] = (flagOnly[5] ?? 0) | FLU_F_MAC;
    assert.equal(reasonOf(flagOnly), 'bad-length', 'MAC claimed but trailer missing');
    const signed = Buffer.concat([flagOnly, Buffer.alloc(FLU_MAC_BYTES, 0xaa)]);
    const p = decodeOk(signed);
    assert.equal(p.hasMac, true);
    const fullSigned = Buffer.concat([
        encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }], full: true }),
        Buffer.alloc(FLU_MAC_BYTES)
    ]);
    fullSigned[5] = (fullSigned[5] ?? 0) | FLU_F_MAC;
    assert.equal(fullSigned.length, FLU_MAX_DATAGRAM, '237 is the ceiling');
    assert.ok(decodeFluPacket(fullSigned).ok);
});
void test('udpCodec: every drop reason fires on its own malformation', () => {
    const good = () => encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    assert.equal(reasonOf(Buffer.alloc(0)), 'bad-length');
    assert.equal(reasonOf(good().subarray(0, FLU_HEADER_BYTES - 1)), 'bad-length');
    assert.equal(reasonOf(Buffer.alloc(FLU_MAX_DATAGRAM + 1, 0x46)), 'bad-length');
    assert.equal(reasonOf(Buffer.concat([good(), Buffer.alloc(1)])), 'bad-length', 'one stray byte');
    const claimsTwo = good();
    claimsTwo[FLU_HEADER_BYTES - 1] = 2;
    assert.equal(reasonOf(claimsTwo), 'bad-length');
    const alien = good();
    alien.write('MQTT', 0, 'latin1');
    assert.equal(reasonOf(alien), 'not-fluidity');
    const v2 = good();
    v2[4] = 2;
    assert.equal(reasonOf(v2), 'bad-version');
    const zero = good().subarray(0, FLU_HEADER_BYTES);
    zero[FLU_HEADER_BYTES - 1] = 0;
    assert.equal(reasonOf(Buffer.from(zero)), 'bad-fields');
    const five = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }], full: true });
    five[FLU_HEADER_BYTES - 1] = 5;
    assert.equal(reasonOf(five), 'bad-fields');
    const badSite = good();
    badSite[12] = 0xff;
    badSite[13] = 0xfe;
    assert.equal(reasonOf(badSite), 'bad-encoding');
    const badText = good();
    badText[FLU_HEADER_BYTES + 2] = 0xc3;
    badText[FLU_HEADER_BYTES + 3] = 0x28;
    assert.equal(reasonOf(badText), 'bad-encoding');
    assert.equal(reasonOf(encodeFluPacket({ site: ' ', plugin: 'p', fields: [{ style: 0, text: 'x' }] })), 'bad-identity');
    assert.equal(reasonOf(encodeFluPacket({ site: 's', plugin: '\x02', fields: [{ style: 0, text: 'x' }] })), 'bad-identity');
    assert.equal(decodeOk(encodeFluPacket({ site: 's', plugin: 'p', description: '', fields: [{ style: 0, text: 'x' }] }))
        .description, '');
});
void test('udpCodec: a multibyte char cut by sender width truncation is trimmed, not dropped', () => {
    const buf = encodeFluPacket({ site: 'cafe', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    buf[16] = 0xc3;
    const p = decodeOk(buf);
    assert.equal(p.site, 'cafe', 'the dangling lead byte is trimmed');
    const buf3 = encodeFluPacket({ site: 'ab', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    buf3[14] = 0xe2;
    buf3[15] = 0x80;
    assert.equal(decodeOk(buf3).site, 'ab');
});
void test('udpCodec: encoder refuses what the wire cannot carry', () => {
    assert.throws(() => encodeFluPacket({ site: 's', plugin: 'p', fields: [] }), /field count/);
    assert.throws(() => encodeFluPacket({
        site: 's',
        plugin: 'p',
        fields: new Array(5).fill({ style: 0, text: 'x' })
    }), /field count/);
    assert.throws(() => encodeFluPacket({ site: 'seventeen-bytes-x', plugin: 'p', fields: [{ style: 0, text: 'x' }] }), /too long/);
    assert.throws(() => encodeFluPacket({ site: 'é'.repeat(9), plugin: 'p', fields: [{ style: 0, text: 'x' }] }), /too long/);
    assert.throws(() => encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'y'.repeat(41) }] }), /too long/);
});
void test('udpCodec: fuzz - random datagrams never crash and never decode', () => {
    const rnd = mulberry32(0xf10d17);
    let decoded = 0;
    for (let i = 0; i < 10_000; i++) {
        const len = Math.floor(rnd() * 300);
        const buf = Buffer.alloc(len);
        for (let b = 0; b < len; b++)
            buf[b] = Math.floor(rnd() * 256);
        const r = decodeFluPacket(buf);
        if (r.ok)
            decoded++;
    }
    assert.equal(decoded, 0, 'random bytes must never pass validation');
});
void test('udpCodec: fuzz - single-byte corruption of a valid packet never crashes the decoder', () => {
    const rnd = mulberry32(0x5eed);
    const pristine = encodeFluPacket({
        site: 'verdugo-pk',
        plugin: 'm5-env',
        description: 'fuzz target',
        deviceSeq: 7,
        tsEpochSec: 1_765_432_100,
        fields: [
            { style: 3, text: 'volts 13.8' },
            { style: 9, text: 'door closed' }
        ]
    });
    for (let i = 0; i < 2_000; i++) {
        const buf = Buffer.from(pristine);
        const at = Math.floor(rnd() * buf.length);
        buf[at] = Math.floor(rnd() * 256);
        const r = decodeFluPacket(buf);
        if (r.ok) {
            assert.ok(r.packet.site.length > 0 && r.packet.plugin.length > 0);
            assert.ok(r.packet.fields.length >= 1 && r.packet.fields.length <= 4);
        }
    }
});
const SIGNED_KEY = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
const signManually = (struct, key) => {
    const flagged = Buffer.from(struct);
    flagged[5] = (flagged[5] ?? 0) | FLU_F_MAC;
    return Buffer.concat([flagged, Buffer.from(siphash24(key, flagged))]);
};
void test('udpCodec: verifyMac receives the exact signed-region/trailer split', () => {
    const wire = signManually(encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] }), SIGNED_KEY);
    let seen;
    const r = decodeFluPacket(wire, {
        verifyMac: (signed, mac) => {
            seen = { signed, mac };
            return true;
        }
    });
    assert.ok(r.ok);
    assert.ok(seen, 'verifier must be consulted for a MAC-flagged datagram');
    assert.equal(seen.signed.length, wire.length - FLU_MAC_BYTES);
    assert.ok(seen.signed.equals(wire.subarray(0, wire.length - FLU_MAC_BYTES)));
    assert.ok(seen.mac.equals(wire.subarray(wire.length - FLU_MAC_BYTES)));
});
void test('udpCodec: verifyMac is never consulted for unsigned datagrams', () => {
    const unsigned = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }] });
    let called = false;
    const r = decodeFluPacket(unsigned, {
        verifyMac: () => {
            called = true;
            return false;
        }
    });
    assert.ok(r.ok, 'unsigned datagrams pass through to caller policy');
    assert.equal(r.packet.hasMac, false);
    assert.equal(called, false);
});
void test('udpCodec: bad-mac masks downstream reasons (§6 step 5 before step 6)', () => {
    const struct = encodeFluPacket({ site: 's', plugin: 'p', fields: [{ style: 0, text: 'x' }], full: true });
    struct[FLU_HEADER_BYTES - 1] = 5;
    const wire = signManually(struct, SIGNED_KEY);
    const rejected = decodeFluPacket(wire, { verifyMac: () => false });
    assert.ok(!rejected.ok && rejected.reason === 'bad-mac');
    const accepted = decodeFluPacket(wire, { verifyMac: () => true });
    assert.ok(!accepted.ok && accepted.reason === 'bad-fields', 'with the MAC good, step 6 fires normally');
});
void test('udpCodec: real SipHash round-trip - genuine trailer passes, any flipped byte drops', () => {
    const wire = signManually(encodeFluPacket({
        site: 'greenhouse',
        plugin: 'm5-env',
        deviceSeq: 99,
        tsEpochSec: 1_765_000_000,
        fields: [{ style: 2, text: 'temp 21.4C' }]
    }), SIGNED_KEY);
    const verifyMac = (signed, mac) => macEqual(siphash24(SIGNED_KEY, signed), mac);
    const r = decodeFluPacket(wire, { verifyMac });
    assert.ok(r.ok);
    assert.equal(r.packet.hasMac, true);
    assert.equal(r.packet.site, 'greenhouse');
    for (const at of [5, 6, 14, FLU_HEADER_BYTES + 4, wire.length - 1]) {
        const evil = Buffer.from(wire);
        evil[at] = (evil[at] ?? 0) ^ 0x01;
        const dropped = decodeFluPacket(evil, { verifyMac });
        assert.ok(!dropped.ok, `flip at byte ${at} must not decode`);
    }
    const otherKey = Uint8Array.from(SIGNED_KEY);
    otherKey[0] = (otherKey[0] ?? 0) ^ 0xff;
    const wrongKey = decodeFluPacket(wire, {
        verifyMac: (signed, mac) => macEqual(siphash24(otherKey, signed), mac)
    });
    assert.ok(!wrongKey.ok && wrongKey.reason === 'bad-mac');
});
