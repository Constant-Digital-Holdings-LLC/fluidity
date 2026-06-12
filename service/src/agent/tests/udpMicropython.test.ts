import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { siphash24, macEqual } from '#@sims/siphash.js';
import { packFluPacket, signFluPacket } from '#@sims/udpDeviceSim.js';
import { encodeFluPacket, decodeFluPacket } from '../modules/udpCodec.js';

//the MicroPython kit (sims/micropython/fluidity_udp.py) is a fourth independent
//implementation of UDP-SPEC s3 (C header, agent codec, TS sim are the others).
//This runs it under any python3 and demands byte-for-byte agreement, so the
//example can't silently drift from the spec. Skipped cleanly where python3 is
//absent (CI has one); same doctrine as the C kit's udpFirmware.test.ts.

const ROOT = resolve('../../..'); //tests run with cwd service/dist/agent
const MODULE_DIR = join(ROOT, 'sims', 'micropython');

const python = ['python3', 'python'].find(p => {
    try {
        return spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
});
const skip = python ? false : 'no python3 on this host';

//harness read from stdin: prints the 64 SipHash vectors, or labeled packets
const HARNESS = `
import sys
sys.path.insert(0, sys.argv[2])
import fluidity_udp as flu
if sys.argv[1] == 'vectors':
    key = bytes(range(16))
    for n in range(64):
        print(flu.siphash24(key, bytes(range(n))).hex())
else:
    def bp(**kw):
        d = dict(site='greenhouse', plugin='m5-env', description='soil probe',
                 fields=[(2,'temp 21.4C'),(7,'rh 64%')], seq=4242)
        d.update(kw)
        return flu.build_packet(d['site'], d['plugin'], d['description'], d['fields'],
                                d['seq'], ts_epoch=d.get('ts'), full=d.get('full', False))
    out = {}
    out['open-compact'] = bp()
    out['open-full'] = bp(full=True)
    out['timestamped'] = bp(ts=1765000000)
    key = bytes(0xa0 + i for i in range(16))
    out['signed'] = flu.sign(flu.build_packet('gate-1','avr-door','driveway',[(10,'closed')],7,full=True), key)
    out['truncated-site'] = flu.build_packet('seventeen-bytes-x','p','',[(0,'x')],1)
    for k, v in out.items():
        print(k, bytes(v).hex())
`;

const run = (mode: 'vectors' | 'packets'): string[] => {
    const res = spawnSync(python as string, ['-', mode, MODULE_DIR], { input: HARNESS, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim().split('\n');
};

const packets = (): Map<string, Buffer> => {
    const wire = new Map<string, Buffer>();
    run('packets').forEach(line => {
        const [label, hex] = line.split(' ');
        assert.ok(label && hex, `unparseable harness line: ${line}`);
        wire.set(label, Buffer.from(hex, 'hex'));
    });
    return wire;
};

void test('MicroPython SipHash-2-4 matches the TS implementation on the 64 official-vector inputs', { skip }, () => {
    const lines = run('vectors');
    assert.equal(lines.length, 64);
    const key = Uint8Array.from({ length: 16 }, (_, i) => i);
    lines.forEach((hex, len) => {
        const msg = Uint8Array.from({ length: len }, (_, i) => i);
        assert.equal(hex, Buffer.from(siphash24(key, msg)).toString('hex'), `vector ${len}`);
    });
});

void test('MicroPython datagrams are byte-identical to both TS implementations', { skip }, () => {
    const wire = packets();
    const greenhouse = {
        site: 'greenhouse',
        plugin: 'm5-env',
        description: 'soil probe',
        deviceSeq: 4242,
        fields: [
            { style: 2, text: 'temp 21.4C' },
            { style: 7, text: 'rh 64%' }
        ]
    };

    assert.ok(wire.get('open-compact')?.equals(encodeFluPacket(greenhouse)), 'py vs agent codec (compact)');
    assert.ok(wire.get('open-compact')?.equals(packFluPacket(greenhouse)), 'py vs sim packer (compact)');
    assert.ok(
        wire.get('open-full')?.equals(encodeFluPacket({ ...greenhouse, full: true })),
        'py vs agent codec (full)'
    );
    assert.ok(
        wire.get('timestamped')?.equals(encodeFluPacket({ ...greenhouse, tsEpochSec: 1_765_000_000 })),
        'py vs agent codec (FLU_F_TS)'
    );
});

void test('a MicroPython MAC-mode datagram verifies and decodes through the agent path', { skip }, () => {
    const wire = packets();
    const key = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
    const signed = wire.get('signed');
    assert.ok(signed);
    assert.equal(signed.length, 237, 'MAC mode sends the full struct + trailer');

    //sign() in python === signFluPacket(encode(full)) in TS
    const tsSigned = signFluPacket(
        encodeFluPacket({
            site: 'gate-1',
            plugin: 'avr-door',
            description: 'driveway',
            deviceSeq: 7,
            fields: [{ style: 10, text: 'closed' }],
            full: true
        }),
        key
    );
    assert.ok(signed.equals(tsSigned), 'py sign vs TS signFluPacket');

    const verifyMac = (s: Buffer, mac: Buffer): boolean => macEqual(siphash24(key, s), mac);
    const r = decodeFluPacket(signed, { verifyMac, requireMac: true });
    assert.ok(r.ok, 'agent must accept the python-built signed datagram');
    assert.equal(r.packet.site, 'gate-1');
    assert.equal(r.packet.hasMac, true);
    assert.deepEqual(r.packet.fields, [{ style: 10, text: 'closed' }]);

    //a flipped byte must fail verification
    const evil = Buffer.from(signed);
    evil[64] = (evil[64] ?? 0) ^ 0x01;
    const dropped = decodeFluPacket(evil, { verifyMac, requireMac: true });
    assert.ok(!dropped.ok && dropped.reason === 'bad-mac');
});

void test('MicroPython strncpy-style truncation matches the sim packer byte-for-byte', { skip }, () => {
    const wire = packets();
    const logical = {
        site: 'seventeen-bytes-x', //17 bytes: one too many, silently truncated
        plugin: 'p',
        deviceSeq: 1,
        fields: [{ style: 0, text: 'x' }]
    };
    assert.ok(wire.get('truncated-site')?.equals(packFluPacket(logical)), 'py vs sim packer truncation');

    const r = decodeFluPacket(wire.get('truncated-site') as Buffer);
    assert.ok(r.ok);
    assert.equal(r.packet.site, 'seventeen-bytes-', 'site occupies its full 16-byte width');
});
