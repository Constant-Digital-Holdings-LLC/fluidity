import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataCollector } from '../modules/collectors.js';
const params = (over = {}) => ({
    site: 'site',
    plugin: 'p',
    description: 'd',
    targets: [{ location: 'https://127.0.0.1:3000/FIFO', key: 'abc123' }],
    maxHttpsReqPerCollectorPerSec: 2,
    ...over
});
const FD = [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }];
class TestCollector extends DataCollector {
    delivered = 0;
    mode = 'resolve';
    release;
    gate = new Promise(r => (this.release = r));
    start() { }
    format() {
        return FD;
    }
    fire() {
        return this.sendPacket(FD);
    }
    releaseGate() {
        this.release();
    }
    async post() {
        this.delivered++;
        if (this.mode === 'reject')
            throw new Error('upstream down');
        if (this.mode === 'hang')
            await this.gate;
        return '';
    }
}
void test('conservation under saturation: delivered + shed == dispatched, nothing vanishes', async () => {
    const c = new TestCollector(params());
    c.mode = 'hang';
    const N = 100;
    const inflight = Array.from({ length: N }, () => c.fire());
    assert.ok(c.delivered > 0, 'some packets were delivered before saturation');
    assert.ok(c.backpressureShed > 0, 'saturation actually shed packets (the bound bit)');
    assert.equal(c.delivered + c.backpressureShed, N, 'delivered + shed accounts for every dispatched packet');
    c.releaseGate();
    await Promise.allSettled(inflight);
});
void test('a failing upstream frees its slot - failures never permanently saturate', async () => {
    const c = new TestCollector(params());
    c.mode = 'reject';
    const N = 40;
    for (let i = 0; i < N; i++)
        await c.fire();
    assert.equal(c.delivered, N, 'every attempt reached the upstream');
    assert.equal(c.backpressureShed, 0, 'a failed POST freed its slot, so nothing was shed');
});
void test('below the cap nothing is shed and the in-flight count drains to zero', async () => {
    const c = new TestCollector(params());
    c.mode = 'resolve';
    const N = 20;
    await Promise.all(Array.from({ length: N }, () => c.fire()));
    assert.equal(c.delivered, N);
    assert.equal(c.backpressureShed, 0);
    await Promise.all(Array.from({ length: N }, () => c.fire()));
    assert.equal(c.delivered, 2 * N, 'slots fully drained between batches');
    assert.equal(c.backpressureShed, 0);
});
void test('a shed dispatch still resolves (a caller awaiting it never hangs)', async () => {
    const c = new TestCollector(params());
    c.mode = 'hang';
    const held = Array.from({ length: 40 }, () => c.fire());
    const shedFire = c.fire();
    let timer;
    const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('shed dispatch hung')), 1000);
    });
    try {
        await Promise.race([shedFire, guard]);
    }
    finally {
        clearTimeout(timer);
    }
    assert.ok(c.backpressureShed > 0, 'the extra dispatch was shed');
    c.releaseGate();
    await Promise.allSettled([...held, shedFire]);
});
