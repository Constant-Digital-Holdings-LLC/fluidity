import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataCollector, DataCollectorParams } from '../modules/collectors.js';
import { FormattedData } from '#@shared/types.js';

//Adversarial / invariant: every packet that enters dispatch() must end up
//either DELIVERED (an upstream POST was attempted) or SHED-and-counted
//(backpressureShed) - never silently lost. Equivalently: a flood costs display
//lines, never agent memory, and a failing upstream must FREE its in-flight slot
//(a leak there would pin pendingPosts at the cap and shed everything forever).
//
//post() is the upstream seam (protected); overriding it gives a controllable,
//network-free upstream. sendPacket() returns the dispatch promise, so the test
//can await an attempt settling (and thus the finally that frees the slot).

const params = (over: Partial<DataCollectorParams> = {}): DataCollectorParams => ({
    site: 'site',
    plugin: 'p',
    description: 'd',
    targets: [{ location: 'https://127.0.0.1:3000/FIFO', key: 'abc123' }],
    maxHttpsReqPerCollectorPerSec: 2, //-> maxPendingPosts floor of 32
    ...over
});

const FD: FormattedData[] = [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }];

type PostMode = 'hang' | 'resolve' | 'reject';

class TestCollector extends DataCollector {
    delivered = 0;
    mode: PostMode = 'resolve';
    private release!: () => void;
    private readonly gate = new Promise<void>(r => (this.release = r));

    start(): void {}
    format(): FormattedData[] | null {
        return FD;
    }
    //drive the bounded dispatch path; sendPacket returns the dispatch promise
    fire(): Promise<void> {
        return this.sendPacket(FD);
    }
    releaseGate(): void {
        this.release();
    }
    protected override async post(): Promise<string> {
        this.delivered++;
        if (this.mode === 'reject') throw new Error('upstream down');
        if (this.mode === 'hang') await this.gate;
        return '';
    }
}

void test('conservation under saturation: delivered + shed == dispatched, nothing vanishes', async () => {
    const c = new TestCollector(params());
    c.mode = 'hang'; //posts never resolve -> pendingPosts pins at the cap
    const N = 100;
    //fire all WITHOUT awaiting; each dispatch runs its synchronous prefix
    //(pendingPosts++ then post(), or shedTotal++) before fire() returns
    const inflight = Array.from({ length: N }, () => c.fire());

    assert.ok(c.delivered > 0, 'some packets were delivered before saturation');
    assert.ok(c.backpressureShed > 0, 'saturation actually shed packets (the bound bit)');
    assert.equal(c.delivered + c.backpressureShed, N, 'delivered + shed accounts for every dispatched packet');

    c.releaseGate();
    await Promise.allSettled(inflight); //a shed dispatch resolves immediately; held ones resolve now
});

void test('a failing upstream frees its slot - failures never permanently saturate', async () => {
    const c = new TestCollector(params());
    c.mode = 'reject'; //every POST throws (the collector logs each, as it should)
    //await each attempt so its finally (pendingPosts--) runs before the next:
    //if a failure leaked its slot, pendingPosts would climb past the 32 cap and
    //the tail would all be shed. 40 > cap, so a leak would surface.
    const N = 40;
    for (let i = 0; i < N; i++) await c.fire();
    assert.equal(c.delivered, N, 'every attempt reached the upstream');
    assert.equal(c.backpressureShed, 0, 'a failed POST freed its slot, so nothing was shed');
});

void test('below the cap nothing is shed and the in-flight count drains to zero', async () => {
    const c = new TestCollector(params());
    c.mode = 'resolve';
    const N = 20; //< the 32 cap
    await Promise.all(Array.from({ length: N }, () => c.fire()));
    assert.equal(c.delivered, N);
    assert.equal(c.backpressureShed, 0);
    //fire another batch: if slots had leaked, these would start shedding
    await Promise.all(Array.from({ length: N }, () => c.fire()));
    assert.equal(c.delivered, 2 * N, 'slots fully drained between batches');
    assert.equal(c.backpressureShed, 0);
});

void test('a shed dispatch still resolves (a caller awaiting it never hangs)', async () => {
    const c = new TestCollector(params());
    c.mode = 'hang';
    //saturate the cap with held posts, then the next dispatch must be shed AND
    //resolve promptly (dispatch returns Promise.resolve() on the shed path)
    const held = Array.from({ length: 40 }, () => c.fire());
    const shedFire = c.fire();
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('shed dispatch hung')), 1000);
    });
    try {
        await Promise.race([shedFire, guard]); //shed returns Promise.resolve(), so this wins at once
    } finally {
        clearTimeout(timer); //don't leave the guard timer (or its rejection) dangling
    }
    assert.ok(c.backpressureShed > 0, 'the extra dispatch was shed');
    c.releaseGate();
    await Promise.allSettled([...held, shedFire]);
});
