import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormatHelper } from '../modules/collectors.js';
void test('FormatHelper types and styles elements', () => {
    const out = new FormatHelper()
        .e('plain')
        .e('styled', 5)
        .e({ name: 'a link', location: 'https://example.net' })
        .e(new Date('2026-01-02T03:04:05.000Z'))
        .e(42)
        .e('trimmed color', 103).done;
    assert.deepEqual(out, [
        { suggestStyle: 0, field: 'plain', fieldType: 'STRING' },
        { suggestStyle: 5, field: 'styled', fieldType: 'STRING' },
        { suggestStyle: 0, field: { name: 'a link', location: 'https://example.net' }, fieldType: 'LINK' },
        { suggestStyle: 0, field: '2026-01-02T03:04:05.000Z', fieldType: 'DATE' },
        { suggestStyle: 0, field: '42', fieldType: 'STRING' },
        { suggestStyle: 103, field: 'trimmed color', fieldType: 'STRING' }
    ]);
});
void test('FormatHelper done drains the buffer and returns a copy', () => {
    const fh = new FormatHelper();
    const first = fh.e('a').done;
    const drained = fh.done;
    assert.equal(first.length, 1);
    assert.deepEqual(drained, []);
    fh.e('b');
    first.push({ suggestStyle: 0, field: 'evil', fieldType: 'STRING' });
    const second = fh.done;
    assert.deepEqual(second.map(f => f.field), ['b']);
});
