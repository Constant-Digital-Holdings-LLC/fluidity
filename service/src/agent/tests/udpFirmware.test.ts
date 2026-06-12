import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { siphash24, macEqual } from '#@sims/siphash.js';
import { packFluPacket, signFluPacket } from '#@sims/udpDeviceSim.js';
import { encodeFluPacket, decodeFluPacket } from '../modules/udpCodec.js';

//the C firmware kit is the third independent implementation of UDP-SPEC s3
//(agent codec and sim packer are the other two). These tests host-compile
//firmware/test/wirecheck.c and demand byte-for-byte agreement. Skipped
//cleanly on hosts without a C compiler (CI's ubuntu always has one).

const ROOT = resolve('../../..'); //tests run with cwd service/dist/agent
const SRC = join(ROOT, 'firmware', 'test', 'wirecheck.c');

const cc = ['cc', 'gcc', 'clang'].find(c => {
    try {
        return spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
});

let bin: string | undefined;
let buildDir: string | undefined;
let compileError = '';

if (cc) {
    buildDir = mkdtempSync(join(tmpdir(), 'flu-firmware-'));
    const out = join(buildDir, 'wirecheck');
    const res = spawnSync(cc, ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2', '-o', out, SRC], {
        encoding: 'utf8'
    });
    if (res.status === 0) {
        bin = out;
    } else {
        compileError = res.stderr;
    }
}

after(() => {
    if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

const run = (mode: 'vectors' | 'packets'): string[] => {
    assert.ok(bin, 'harness binary missing');
    const res = spawnSync(bin, [mode], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    return res.stdout.trim().split('\n');
};

const skip = cc ? false : 'no C compiler on this host';

void test('fluidity_udp.h compiles clean under -Wall -Wextra -Werror', { skip }, () => {
    //a compiler exists, so a failed build is a FAILURE, not a skip - the
    //header must be warning-free for every firmware consumer
    assert.ok(bin, `${cc ?? 'cc'} rejected the firmware kit:\n${compileError}`);
});

void test('C SipHash-2-4 matches the TS implementation on the 64 official-vector inputs', { skip }, () => {
    const lines = run('vectors');
    assert.equal(lines.length, 64);

    const key = Uint8Array.from({ length: 16 }, (_, i) => i);
    lines.forEach((hex, len) => {
        const msg = Uint8Array.from({ length: len }, (_, i) => i);
        assert.equal(hex, Buffer.from(siphash24(key, msg)).toString('hex'), `vector ${len}`);
    });
});

void test('C firmware datagrams are byte-identical to both TS implementations', { skip }, () => {
    const wire = new Map<string, Buffer>();
    run('packets').forEach(line => {
        const [label, hex] = line.split(' ');
        assert.ok(label && hex, `unparseable harness line: ${line}`);
        wire.set(label, Buffer.from(hex, 'hex'));
    });

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

    //three-way agreement on the compact form: C, agent encoder, sim packer
    assert.ok(wire.get('open-compact')?.equals(encodeFluPacket(greenhouse)), 'C vs agent codec (compact)');
    assert.ok(wire.get('open-compact')?.equals(packFluPacket(greenhouse)), 'C vs sim packer (compact)');

    assert.ok(
        wire.get('open-full')?.equals(encodeFluPacket({ ...greenhouse, full: true })),
        'C vs agent codec (full struct)'
    );

    assert.ok(
        wire.get('timestamped')?.equals(encodeFluPacket({ ...greenhouse, tsEpochSec: 1_765_000_000 })),
        'C vs agent codec (FLU_F_TS)'
    );
});

void test('a C MAC-mode datagram verifies and decodes through the agent path', { skip }, () => {
    const wire = new Map<string, Buffer>();
    run('packets').forEach(line => {
        const [label, hex] = line.split(' ');
        if (label && hex) wire.set(label, Buffer.from(hex, 'hex'));
    });

    const key = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
    const signed = wire.get('signed');
    assert.ok(signed);
    assert.equal(signed.length, 237, 'MAC mode always sends the full struct + trailer');

    //flu_sign in C === sign(encode(full)) in TS
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
    assert.ok(signed.equals(tsSigned), 'C flu_sign vs TS signFluPacket');

    const verifyMac = (s: Buffer, mac: Buffer): boolean => macEqual(siphash24(key, s), mac);
    const r = decodeFluPacket(signed, { verifyMac });
    assert.ok(r.ok, 'agent must accept the C-built signed datagram');
    assert.equal(r.packet.site, 'gate-1');
    assert.equal(r.packet.hasMac, true);
    assert.deepEqual(r.packet.fields, [{ style: 10, text: 'closed' }]);

    //and one flipped byte must fail verification
    const evil = Buffer.from(signed);
    evil[64] = (evil[64] ?? 0) ^ 0x01;
    const dropped = decodeFluPacket(evil, { verifyMac });
    assert.ok(!dropped.ok && dropped.reason === 'bad-mac');
});

void test('C strncpy-style truncation matches the sim packer byte-for-byte', { skip }, () => {
    const wire = new Map<string, Buffer>();
    run('packets').forEach(line => {
        const [label, hex] = line.split(' ');
        if (label && hex) wire.set(label, Buffer.from(hex, 'hex'));
    });

    const logical = {
        site: 'seventeen-bytes-x', //17 bytes: one too many, silently truncated
        plugin: 'p',
        deviceSeq: 1,
        fields: [{ style: 0, text: 'x' }]
    };
    assert.ok(wire.get('truncated-site')?.equals(packFluPacket(logical)), 'C vs sim packer truncation');

    const r = decodeFluPacket(wire.get('truncated-site') as Buffer);
    assert.ok(r.ok);
    assert.equal(r.packet.site, 'seventeen-bytes-', 'site occupies its full 16-byte width');
});
