import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLine } from '../modules/renderLine.js';
const ESC = '\x1b';
const BEL = '\x07';
const DEL = '\x7f';
const CSI = '\u009b';
const NEL = '\u0085';
const CR = '\r';
const CONTROL = [ESC, BEL, DEL, CSI, NEL, CR];
const caps = (tier, hyperlinks = false) => ({ tier, hyperlinks });
const opts = (tier, extra = {}) => ({
    caps: caps(tier),
    timeZone: 'UTC',
    locale: 'en-US',
    ...extra
});
const pkt = (fd) => ({
    seq: 1,
    ts: '2026-06-11T13:30:38.068Z',
    site: 'Site',
    description: 'desc',
    plugin: 'p',
    formattedData: fd
});
const assertEscapeFree = (line, where) => {
    for (const ch of CONTROL) {
        const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
        assert.ok(!line.includes(ch), `${where}: control byte U+${hex} leaked into terminal output`);
    }
};
const evil = (label) => `${label}${ESC}[31m${BEL}${DEL}${CSI}2J${NEL}`;
void test('malformed LINK (non-https) with control bytes does not inject in mono', () => {
    const fd = [
        { suggestStyle: 0, fieldType: 'LINK', field: { name: 'n', location: `ftp://${evil('evil')}` } }
    ];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'malformed-link-object');
});
void test('LINK whose field is a bare string (fails the guard) is sanitized, not dumped raw', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'LINK', field: evil('plain') }];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'link-bare-string');
});
void test('an out-of-union fieldType (the default branch) sanitizes its field', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'WEIRD', field: evil('x') }];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'unknown-fieldType');
});
void test('a STRING field that is not actually a string still gets sanitized via asText', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'STRING', field: { e: evil('o') } }];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'non-string-STRING');
});
void test('a VALID link may carry control chars in its NAME - they must be stripped (hyperlinks on)', () => {
    const fd = [
        { suggestStyle: 0, fieldType: 'LINK', field: { name: evil('click'), location: 'https://ham.live/x' } }
    ];
    const line = renderLine(pkt(fd), opts('mono', { caps: caps('mono', true) }));
    const oscOpen = `${ESC}]8;;https://ham.live/x${BEL}`;
    assert.ok(line.includes(oscOpen), 'OSC 8 hyperlink is emitted with the (clean) https location');
    const withoutFrames = line.split(`${ESC}]8;;`).join('').split(BEL).join('');
    assertEscapeFree(withoutFrames, 'valid-link-name (frames removed)');
});
void test('control bytes are stripped from site and description as well', () => {
    const p = pkt([{ suggestStyle: 0, field: 'ok', fieldType: 'STRING' }]);
    p.site = evil('S');
    p.description = evil('d');
    assertEscapeFree(renderLine(p, opts('mono')), 'site/desc');
});
void test('out-of-range suggestStyle (the guard accepts finite values) never throws or injects', () => {
    const styles = [-1, -999, 1e9, 100, 109, 250, NaN, Infinity, -Infinity];
    for (const tier of ['mono', '16', '256', 'truecolor']) {
        for (const suggestStyle of styles) {
            const p = pkt([{ suggestStyle, field: evil('v'), fieldType: 'STRING' }]);
            let line = '';
            assert.doesNotThrow(() => (line = renderLine(p, opts(tier))), `style ${suggestStyle} @ ${tier} threw`);
            if (tier === 'mono')
                assertEscapeFree(line, `style ${suggestStyle} @ mono`);
        }
    }
});
//# sourceMappingURL=renderLineAdversarial.test.js.map