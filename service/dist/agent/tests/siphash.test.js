import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siphash24, macEqual, sipKeyFromHex, SIP_KEY_BYTES, SIP_MAC_BYTES } from '#@sims/siphash.js';
const OFFICIAL_VECTORS = [
    '310e0edd47db6f72',
    'fd67dc93c539f874',
    '5a4fa9d909806c0d',
    '2d7efbd796666785',
    'b7877127e09427cf',
    '8da699cd64557618',
    'cee3fe586e46c9cb',
    '37d1018bf50002ab',
    '6224939a79f5f593',
    'b0e4a90bdf82009e',
    'f3b9dd94c5bb5d7a',
    'a7ad6b22462fb3f4',
    'fbe50e86bc8f1e75',
    '903d84c02756ea14',
    'eef27a8e90ca23f7',
    'e545be4961ca29a1',
    'db9bc2577fcc2a3f',
    '9447be2cf5e99a69',
    '9cd38d96f0b3c14b',
    'bd6179a71dc96dbb',
    '98eea21af25cd6be',
    'c7673b2eb0cbf2d0',
    '883ea3e395675393',
    'c8ce5ccd8c030ca8',
    '94af49f6c650adb8',
    'eab8858ade92e1bc',
    'f315bb5bb835d817',
    'adcf6b0763612e2f',
    'a5c91da7acaa4dde',
    '716595876650a2a6',
    '28ef495c53a387ad',
    '42c341d8fa92d832',
    'ce7cf2722f512771',
    'e37859f94623f3a7',
    '381205bb1ab0e012',
    'ae97a10fd434e015',
    'b4a31508beff4d31',
    '81396229f0907902',
    '4d0cf49ee5d4dcca',
    '5c73336a76d8bf9a',
    'd0a704536ba93e0e',
    '925958fcd6420cad',
    'a915c29bc8067318',
    '952b79f3bc0aa6d4',
    'f21df2e41d4535f9',
    '87577519048f53a9',
    '10a56cf5dfcd9adb',
    'eb75095ccd986cd0',
    '51a9cb9ecba312e6',
    '96afadfc2ce666c7',
    '72fe52975a4364ee',
    '5a1645b276d592a1',
    'b274cb8ebf87870a',
    '6f9bb4203de7b381',
    'eaecb2a30b22a87f',
    '9924a43cc1315724',
    'bd838d3aafbf8db7',
    '0b1a2a3265d51aea',
    '135079a3231ce660',
    '932b2846e4d70666',
    'e1915f5cb1eca46c',
    'f325965ca16d629f',
    '575ff28e60381be5',
    '724506eb4c328a95'
];
const REF_KEY = Uint8Array.from({ length: 16 }, (_, i) => i);
const hex = (u8) => Array.from(u8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
void test('siphash24 matches all 64 official reference vectors', () => {
    assert.equal(OFFICIAL_VECTORS.length, 64);
    OFFICIAL_VECTORS.forEach((expected, len) => {
        const msg = Uint8Array.from({ length: len }, (_, i) => i);
        assert.equal(hex(siphash24(REF_KEY, msg)), expected, `vector for ${len}-byte message`);
    });
});
void test('siphash24 is keyed: a one-bit key change scrambles the MAC', () => {
    const msg = new TextEncoder().encode('fluidity flu_packet_v1');
    const k2 = Uint8Array.from(REF_KEY);
    k2[15] = (k2[15] ?? 0) ^ 0x01;
    assert.notEqual(hex(siphash24(REF_KEY, msg)), hex(siphash24(k2, msg)));
});
void test('siphash24 output depends on every message byte and on length', () => {
    const msg = Uint8Array.from({ length: 237 }, (_, i) => (i * 31) & 0xff);
    const base = hex(siphash24(REF_KEY, msg));
    for (const at of [0, 5, 60, 128, 236]) {
        const tampered = Uint8Array.from(msg);
        tampered[at] = (tampered[at] ?? 0) ^ 0x80;
        assert.notEqual(hex(siphash24(REF_KEY, tampered)), base, `flip at byte ${at}`);
    }
    assert.notEqual(hex(siphash24(REF_KEY, msg.subarray(0, 236))), base, 'truncation changes the MAC');
});
void test('siphash24 reads subarray views correctly (Buffer pool offsets)', () => {
    const pool = Buffer.alloc(64, 0xaa);
    const msg = Uint8Array.from({ length: 19 }, (_, i) => i);
    msg.forEach((b, i) => pool.writeUInt8(b, 8 + i));
    const view = pool.subarray(8, 8 + 19);
    assert.equal(hex(siphash24(REF_KEY, view)), OFFICIAL_VECTORS[19]);
});
void test('siphash24 refuses a key that is not exactly 16 bytes', () => {
    assert.throws(() => siphash24(new Uint8Array(15), new Uint8Array(0)), /16 bytes/);
    assert.throws(() => siphash24(new Uint8Array(17), new Uint8Array(0)), /16 bytes/);
});
void test('macEqual compares exactly and tolerates length mismatch', () => {
    const a = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(macEqual(a, Uint8Array.from(a)));
    const b = Uint8Array.from(a);
    b[7] = 9;
    assert.ok(!macEqual(a, b));
    assert.ok(!macEqual(a, a.subarray(0, 7)));
});
void test('sipKeyFromHex parses 32 hex chars and rejects everything else', () => {
    const key = sipKeyFromHex('000102030405060708090a0B0c0D0e0F');
    assert.ok(key);
    assert.equal(key.length, SIP_KEY_BYTES);
    assert.deepEqual(Array.from(key), Array.from(REF_KEY));
    assert.equal(sipKeyFromHex(''), null);
    assert.equal(sipKeyFromHex('0123456789abcdef'), null, '8 bytes is too short');
    assert.equal(sipKeyFromHex('0123456789abcdef0123456789abcdef00'), null, '17 bytes is too long');
    assert.equal(sipKeyFromHex('0123456789abcdef0123456789abcdeg'), null, 'non-hex digit');
});
void test('siphash24 throughput is far beyond the 1k datagrams/s requirement', () => {
    const msg = Uint8Array.from({ length: 229 }, (_, i) => i & 0xff);
    let sink = 0;
    for (let i = 0; i < 50_000; i++) {
        msg[0] = i & 0xff;
        sink ^= siphash24(REF_KEY, msg)[0] ?? 0;
    }
    const iters = 200_000;
    const started = Date.now();
    for (let i = 0; i < iters; i++) {
        msg[0] = i & 0xff;
        sink ^= siphash24(REF_KEY, msg)[0] ?? 0;
    }
    const elapsed = Date.now() - started;
    const perSec = Math.round(iters / (elapsed / 1000));
    assert.ok(sink >= 0);
    assert.equal(siphash24(REF_KEY, msg).length, SIP_MAC_BYTES);
    assert.ok(perSec > 50_000, `siphash too slow: ${perSec}/s`);
    console.log(`siphash24: ${(perSec / 1000).toFixed(0)}k MACs/s over 229-byte messages (warm)`);
});
