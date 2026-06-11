import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PacketFIFO } from '../modules/packetFIFO.js';
import { fetchLogger } from '#@shared/modules/logger.js';
import { FluidityPacket } from '#@shared/types.js';

const log = fetchLogger({ logLevel: 'never' });

const pkt = (site: string): FluidityPacket => ({
    site,
    ts: '2026-06-11T00:00:00.000Z',
    description: 'desc',
    plugin: 'genericSerial',
    formattedData: []
});

void test('assigns increasing seq and evicts oldest beyond maxSize', () => {
    const fifo = new PacketFIFO(3, log);
    const seqs = ['a', 'b', 'c', 'd', 'e'].map(site => fifo.push(pkt(site)));

    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
    assert.deepEqual(
        fifo.toArray().map(p => p.site),
        ['c', 'd', 'e']
    );
    assert.deepEqual(
        fifo.toArray().map(p => p.seq),
        [3, 4, 5]
    );
});

void test('toArray returns a defensive copy', () => {
    const fifo = new PacketFIFO(3, log);
    fifo.push(pkt('a'));

    fifo.toArray().pop();
    assert.equal(fifo.toArray().length, 1);
});

void test('seq counters are independent per FIFO instance', () => {
    const a = new PacketFIFO(3, log);
    const b = new PacketFIFO(3, log);

    a.push(pkt('x'));
    assert.equal(b.push(pkt('y')), 1);
});
