import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidityPacket, FormattedData } from '#@shared/types.js';
import { renderLine, RenderOpts } from '../modules/renderLine.js';
import { TermCaps } from '../modules/caps.js';

//Adversarial: renderLine's stated invariant is that output is escape-free in
//mono and never lets untrusted serial data inject terminal control sequences.
//These cases attack every field path with C0 (ESC/BEL), DEL (0x7f), and C1
//(0x9b CSI / 0x85 NEL) bytes - including the defensive fallbacks for a
//malformed LINK and an out-of-union fieldType, which JSON.stringify does NOT
//escape for DEL/C1. The server's type-guard rejects such packets upstream, but
//the renderer treats all input as hostile by design, so the invariant holds
//regardless. All control bytes here are written as \x / \u escapes - never
//literal - so the source stays readable and lint-safe.

const ESC = '\x1b';
const BEL = '\x07';
const DEL = '\x7f';
const CSI = '\u009b'; //C1 CSI
const NEL = '\u0085'; //C1 NEL
const CR = '\r';
const CONTROL = [ESC, BEL, DEL, CSI, NEL, CR];

const caps = (tier: TermCaps['tier'], hyperlinks = false): TermCaps => ({ tier, hyperlinks });
const opts = (tier: TermCaps['tier'], extra: Partial<RenderOpts> = {}): RenderOpts => ({
    caps: caps(tier),
    timeZone: 'UTC',
    locale: 'en-US',
    ...extra
});

const pkt = (fd: FormattedData[]): FluidityPacket => ({
    seq: 1,
    ts: '2026-06-11T13:30:38.068Z',
    site: 'Site',
    description: 'desc',
    plugin: 'p',
    formattedData: fd
});

const assertEscapeFree = (line: string, where: string): void => {
    for (const ch of CONTROL) {
        const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
        assert.ok(!line.includes(ch), `${where}: control byte U+${hex} leaked into terminal output`);
    }
};

//a sampler of hostile bytes embedded in a payload string
const evil = (label: string): string => `${label}${ESC}[31m${BEL}${DEL}${CSI}2J${NEL}`;

void test('malformed LINK (non-https) with control bytes does not inject in mono', () => {
    const fd = [
        { suggestStyle: 0, fieldType: 'LINK', field: { name: 'n', location: `ftp://${evil('evil')}` } }
    ] as unknown as FormattedData[];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'malformed-link-object');
});

void test('LINK whose field is a bare string (fails the guard) is sanitized, not dumped raw', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'LINK', field: evil('plain') }] as unknown as FormattedData[];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'link-bare-string');
});

void test('an out-of-union fieldType (the default branch) sanitizes its field', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'WEIRD', field: evil('x') }] as unknown as FormattedData[];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'unknown-fieldType');
});

void test('a STRING field that is not actually a string still gets sanitized via asText', () => {
    const fd = [{ suggestStyle: 0, fieldType: 'STRING', field: { e: evil('o') } }] as unknown as FormattedData[];
    assertEscapeFree(renderLine(pkt(fd), opts('mono')), 'non-string-STRING');
});

void test('a VALID link may carry control chars in its NAME - they must be stripped (hyperlinks on)', () => {
    //isFluidityLink requires only a non-empty name; it does NOT forbid control
    //chars there. With hyperlinks enabled the name sits inside the OSC 8 text
    //segment, so an unstripped ESC/BEL could terminate the hyperlink early.
    //Use mono+hyperlinks so the ONLY legitimate control bytes are the OSC 8
    //framing itself (no ANSI color codes from painting to confuse the check).
    const fd = [
        { suggestStyle: 0, fieldType: 'LINK', field: { name: evil('click'), location: 'https://ham.live/x' } }
    ] as FormattedData[];
    const line = renderLine(pkt(fd), opts('mono', { caps: caps('mono', true) }));
    const oscOpen = `${ESC}]8;;https://ham.live/x${BEL}`;
    assert.ok(line.includes(oscOpen), 'OSC 8 hyperlink is emitted with the (clean) https location');
    //strip the two legitimate OSC 8 frames; nothing hostile may remain
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
    //the type-guard only requires suggestStyle be a finite number - it does NOT
    //bound it - so negative, huge, and trim-encoded (>=100) styles are reachable.
    //decodeSuggestStyle does style%10; the renderer must stay crash- and
    //escape-free across every tier for all of them (incl. defensive NaN/Infinity).
    const styles = [-1, -999, 1e9, 100, 109, 250, NaN, Infinity, -Infinity];
    for (const tier of ['mono', '16', '256', 'truecolor'] as const) {
        for (const suggestStyle of styles) {
            const p = pkt([{ suggestStyle, field: evil('v'), fieldType: 'STRING' }]);
            let line = '';
            assert.doesNotThrow(() => (line = renderLine(p, opts(tier))), `style ${suggestStyle} @ ${tier} threw`);
            if (tier === 'mono') assertEscapeFree(line, `style ${suggestStyle} @ mono`);
        }
    }
});
