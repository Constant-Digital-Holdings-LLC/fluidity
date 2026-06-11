import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidityPacket } from '#@shared/types.js';
import { matchesFilters } from '../modules/filters.js';

const pkt = (site: string, plugin: string): FluidityPacket => ({
    site,
    plugin,
    ts: '2026-06-11T00:00:00.000Z',
    description: 'd',
    formattedData: []
});

void test('filter semantics mirror the web client: OR within groups, AND across', () => {
    const a = pkt('SiteA', 'srsSerial');
    const b = pkt('SiteB', 'genericSerial');

    //no filters: everything passes
    assert.ok(matchesFilters(a, { sites: [], collectors: [] }));

    //site group ORs
    assert.ok(matchesFilters(a, { sites: ['SiteA', 'SiteB'], collectors: [] }));
    assert.ok(!matchesFilters(a, { sites: ['SiteB'], collectors: [] }));

    //collector group ORs
    assert.ok(matchesFilters(b, { sites: [], collectors: ['genericSerial'] }));
    assert.ok(!matchesFilters(b, { sites: [], collectors: ['srsSerial'] }));

    //groups intersect
    assert.ok(matchesFilters(a, { sites: ['SiteA'], collectors: ['srsSerial'] }));
    assert.ok(!matchesFilters(a, { sites: ['SiteA'], collectors: ['genericSerial'] }));
    assert.ok(!matchesFilters(b, { sites: ['SiteA'], collectors: ['genericSerial'] }));
});
