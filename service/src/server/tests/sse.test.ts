import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { ServerSideEvents } from '../modules/sse.js';

//minimal req/res doubles: EventEmitters with the Response surface SSE touches
interface FakeRes extends EventEmitter {
    writeHead(): FakeRes;
    write(s: string): boolean;
    written: string[];
    throwOnWrite?: boolean;
}

const make = (): { req: EventEmitter; res: FakeRes } => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), {
        written: [] as string[],
        throwOnWrite: false,
        writeHead(): FakeRes {
            return res;
        },
        write(s: string): boolean {
            if (res.throwOnWrite) throw new Error('EPIPE: socket destroyed');
            res.written.push(s);
            return true;
        }
    }) as FakeRes;
    return { req, res };
};

const init = (sse: ServerSideEvents, req: EventEmitter, res: FakeRes): void =>
    sse.init(req as unknown as Request, res as unknown as Response);

void test('SSE: a client socket error drops the client instead of crashing the server', () => {
    const sse = new ServerSideEvents();
    const { req, res } = make();
    init(sse, req, res);

    sse.send('hello');
    assert.ok(
        res.written.some(w => w.includes('data: hello')),
        'subscribed client receives the broadcast'
    );

    //the response emits 'error' (reset / premature close) independently of close.
    //Before the fix this had no listener and crashed the process; now it drops.
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

    bad.res.throwOnWrite = true; //its socket is already destroyed
    assert.doesNotThrow(() => sse.send('broadcast'));

    assert.ok(
        good.res.written.some(w => w.includes('data: broadcast')),
        'the healthy client still receives the message'
    );

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
