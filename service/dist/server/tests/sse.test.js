import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ServerSideEvents } from '../modules/sse.js';
const make = () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), {
        written: [],
        throwOnWrite: false,
        writeHead() {
            return res;
        },
        write(s) {
            if (res.throwOnWrite)
                throw new Error('EPIPE: socket destroyed');
            res.written.push(s);
            return true;
        }
    });
    return { req, res };
};
const init = (sse, req, res) => sse.init(req, res);
void test('SSE: a client socket error drops the client instead of crashing the server', () => {
    const sse = new ServerSideEvents();
    const { req, res } = make();
    init(sse, req, res);
    sse.send('hello');
    assert.ok(res.written.some(w => w.includes('data: hello')), 'subscribed client receives the broadcast');
    assert.doesNotThrow(() => res.emit('error', new Error('ECONNRESET')));
    const before = res.written.length;
    sse.send('after-error');
    assert.equal(res.written.length, before, 'a dropped client gets no further writes');
});
void test('SSE: a throwing write removes that client and the broadcast reaches the rest', () => {
    const sse = new ServerSideEvents();
    const good = make();
    const bad = make();
    init(sse, good.req, good.res);
    init(sse, bad.req, bad.res);
    bad.res.throwOnWrite = true;
    assert.doesNotThrow(() => sse.send('broadcast'));
    assert.ok(good.res.written.some(w => w.includes('data: broadcast')), 'the healthy client still receives the message');
    bad.res.throwOnWrite = false;
    sse.send('again');
    assert.ok(!bad.res.written.some(w => w.includes('data: again')), 'the failed client was dropped from the set');
});
void test('SSE: req close still removes the client', () => {
    const sse = new ServerSideEvents();
    const { req, res } = make();
    init(sse, req, res);
    req.emit('close');
    const before = res.written.length;
    sse.send('post-close');
    assert.equal(res.written.length, before, 'closed client no longer receives broadcasts');
});
