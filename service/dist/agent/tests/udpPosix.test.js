import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isFfluidityPacket } from '#@shared/types.js';
import UdpStructCollector from '../modules/collectors/udpStruct.js';
import { startTarget } from './helpers.js';
const ROOT = resolve('../../..');
const FW = join(ROOT, 'firmware');
const cc = ['cc', 'gcc', 'clang'].find(c => {
    try {
        return spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0;
    }
    catch {
        return false;
    }
});
const skip = process.platform === 'win32' ? 'flu_udp_posix.h is POSIX-only' : cc ? false : 'no C compiler on this host';
let buildDir;
let emit;
let exampleOk = false;
let compileErr = '';
if (cc && process.platform !== 'win32') {
    buildDir = mkdtempSync(join(tmpdir(), 'flu-posix-'));
    const common = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2'];
    const e = join(buildDir, 'udpsend');
    const r1 = spawnSync(cc, [...common, '-o', e, join(FW, 'test', 'udpsend.c')], {
        encoding: 'utf8'
    });
    if (r1.status === 0)
        emit = e;
    else
        compileErr += r1.stderr;
    const r2 = spawnSync(cc, [...common, '-o', join(buildDir, 'telemetry'), join(FW, 'examples', 'posix-telemetry.c')], {
        encoding: 'utf8'
    });
    exampleOk = r2.status === 0;
    if (!exampleOk)
        compileErr += r2.stderr;
}
after(() => {
    if (buildDir)
        rmSync(buildDir, { recursive: true, force: true });
});
const withTimeout = async (p, ms, msg) => {
    let t;
    const guard = new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error(msg)), ms);
    });
    try {
        return await Promise.race([p, guard]);
    }
    finally {
        clearTimeout(t);
    }
};
const collectorTo = (target, extendedOptions) => new UdpStructCollector({
    plugin: 'udpStruct',
    description: 'posix e2e',
    site: 'agent',
    targets: [{ location: target.location, key: 'loadtestkey1' }],
    port: 0,
    bind: '127.0.0.1',
    ...(extendedOptions ? { extendedOptions } : {})
});
void test('flu_udp_posix.h, the example, and the emitter compile clean (-Wall -Wextra -Werror)', { skip }, () => {
    assert.ok(emit, `${cc ?? 'cc'} rejected udpsend.c / flu_udp_posix.h:\n${compileErr}`);
    assert.ok(exampleOk, `${cc ?? 'cc'} rejected examples/posix-telemetry.c:\n${compileErr}`);
});
void test('a C program publishes to the udpStruct collector over real UDP (open mode)', { skip }, async () => {
    const target = await startTarget();
    const collector = collectorTo(target);
    collector.start();
    try {
        const port = await collector.ready();
        const res = spawnSync(emit, ['127.0.0.1', String(port)], { encoding: 'utf8' });
        assert.equal(res.status, 0, res.stderr);
        const body = await withTimeout(target.next(), 4000, 'collector did not forward the C datagram');
        assert.ok(isFfluidityPacket(body), 'a valid FluidityPacket reached the upstream target');
        assert.equal(body.site, 'proc-a', 'siteFromPacket: the device names its own site');
        assert.equal(body.plugin, 'posix-c');
        assert.deepEqual(body.formattedData, [
            { suggestStyle: 4, field: 'depth 12', fieldType: 'STRING' },
            { suggestStyle: 10, field: 'ok', fieldType: 'STRING' }
        ]);
    }
    finally {
        collector.stop();
        target.server.close();
    }
});
void test('a C program signs (MAC mode) and a requireMac collector accepts it', { skip }, async () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const target = await startTarget();
    const collector = collectorTo(target, { secret, requireMac: true });
    collector.start();
    try {
        const port = await collector.ready();
        const res = spawnSync(emit, ['127.0.0.1', String(port), secret], { encoding: 'utf8' });
        assert.equal(res.status, 0, res.stderr);
        const body = await withTimeout(target.next(), 4000, 'requireMac collector did not forward the signed datagram');
        assert.ok(isFfluidityPacket(body));
        assert.equal(body.site, 'proc-a');
        assert.deepEqual(body.formattedData, [
            { suggestStyle: 4, field: 'depth 12', fieldType: 'STRING' },
            { suggestStyle: 10, field: 'ok', fieldType: 'STRING' }
        ]);
    }
    finally {
        collector.stop();
        target.server.close();
    }
});
