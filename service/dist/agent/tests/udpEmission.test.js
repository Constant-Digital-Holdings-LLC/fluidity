import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLoadtest } from '../../loadtest/harness.js';
const SECRET = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
void test('emission e2e: valid datagrams traverse emitter -> agent -> server', async () => {
    const r = await runLoadtest({ rate: 300, durationSec: 1, mix: { valid: 100 }, seed: 1 });
    assert.equal(r.offered, 300, 'emitter sent exactly the requested count');
    assert.ok(r.server.posts >= 280, `nearly all valid datagrams reached the server (${r.server.posts}/300)`);
    assert.deepEqual(r.agent.drops, {}, 'valid traffic produces no drops');
    assert.equal(r.agent.shed, 0, 'well under the throttle: nothing shed');
});
void test('emission e2e: garbage is dropped at the agent, never forwarded', async () => {
    const r = await runLoadtest({ rate: 300, durationSec: 1, mix: { garbage: 100 }, seed: 2 });
    assert.equal(r.server.posts, 0, 'no garbage datagram ever reaches the server');
    const dropped = Object.values(r.agent.drops).reduce((a, b) => a + b, 0);
    assert.ok(dropped >= 280, `garbage is decoded and dropped by reason (${dropped}/300)`);
    assert.ok((r.agent.drops['not-fluidity'] ?? 0) > 0, 'most random bytes fail the magic check');
});
void test('emission e2e: MAC mode passes signed traffic and rejects tampered', async () => {
    const signed = await runLoadtest({ rate: 300, durationSec: 1, mix: { valid: 100 }, secret: SECRET, seed: 3 });
    assert.ok(signed.server.posts >= 280, `signed datagrams verify and forward (${signed.server.posts}/300)`);
    assert.equal(signed.agent.drops['bad-mac'] ?? 0, 0, 'genuine signatures never drop');
    const tampered = await runLoadtest({ rate: 300, durationSec: 1, mix: { tampered: 100 }, secret: SECRET, seed: 4 });
    assert.equal(tampered.server.posts, 0, 'tampered datagrams never reach the server');
    assert.ok((tampered.agent.drops['bad-mac'] ?? 0) >= 280, 'every tampered trailer is caught as bad-mac');
});
void test('emission e2e: live packets fan out to SSE subscribers', async () => {
    const r = await runLoadtest({ rate: 200, durationSec: 1, mix: { valid: 100 }, sseClients: 4, seed: 5 });
    assert.ok(r.sse, 'SSE metrics collected');
    assert.equal(r.sse.clients, 4);
    assert.ok(r.sse.frames >= r.server.posts, `every post is fanned out (${r.sse.frames} frames, ${r.server.posts} posts)`);
    assert.ok(r.sse.latP95Ms < 2000, `fanout latency stays sane (p95 ${r.sse.latP95Ms}ms)`);
});
