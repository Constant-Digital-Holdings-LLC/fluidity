import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, addPacket } from '../modules/uiModel.js';
import { renderParts } from '../modules/renderLine.js';
import { composeFrame } from '../modules/screen.js';
const caps = { tier: 'mono', hyperlinks: false };
const opts = { caps, timeZone: 'UTC', locale: 'en-US' };
const ESC = '\x1b';
const C1 = '\u009b';
void test('the sites pane strips control chars from an untrusted site name', () => {
    const st = initialState(120, 24, 'localhost:3000', 4000);
    const evilSite = `gh${ESC}[2J${C1}X`;
    const p = {
        site: evilSite,
        plugin: 'p',
        ts: '2026-06-11T00:00:00.000Z',
        description: 'd',
        formattedData: [{ suggestStyle: 0, field: 'x', fieldType: 'STRING' }]
    };
    addPacket(st, p, renderParts(p, opts));
    const frame = composeFrame(st, caps).join('\n');
    assert.ok(!frame.includes(ESC), 'no ESC anywhere in the mono frame (pane name was sanitized)');
    assert.ok(!frame.includes(C1), 'no C1 CSI from the site name');
    assert.match(frame, /GH\[2JX/, 'the name renders with the control bytes stripped, residue inert');
});
//# sourceMappingURL=screen.test.js.map