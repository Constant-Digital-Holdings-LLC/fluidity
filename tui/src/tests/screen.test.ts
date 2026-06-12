import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidityPacket } from '#@shared/types.js';
import { initialState, addPacket } from '../modules/uiModel.js';
import { renderParts, RenderOpts } from '../modules/renderLine.js';
import { composeFrame } from '../modules/screen.js';
import { TermCaps } from '../modules/caps.js';

//Adversarial: the bottom pane lists reporting site/plugin names, which are
//untrusted device data. A hostile name must not inject a terminal escape into
//the pane (the stream lines already sanitize via renderLine; the pane path
//must too). In mono the whole frame should be escape-free, so any leak shows.

const caps: TermCaps = { tier: 'mono', hyperlinks: false };
const opts: RenderOpts = { caps, timeZone: 'UTC', locale: 'en-US' };

const ESC = '\x1b';
const C1 = '\u009b'; //C1 CSI

void test('the sites pane strips control chars from an untrusted site name', () => {
    const st = initialState(120, 24, 'localhost:3000', 4000);
    const evilSite = `gh${ESC}[2J${C1}X`; //clear-screen + C1 CSI buried in the name
    const p: FluidityPacket = {
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
    //the escape is neutralized to inert text (control bytes gone, the printable
    //"[2J" residue stays harmless) and the name still renders, uppercased
    assert.match(frame, /GH\[2JX/, 'the name renders with the control bytes stripped, residue inert');
});
