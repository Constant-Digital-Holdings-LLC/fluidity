import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFormattedData } from '#@shared/types.js';
import { tokenize, parseTokenizeConfig, toFields } from '../modules/tokenize.js';
const cfg = parseTokenizeConfig(undefined, true, 't');
const tok = (line) => tokenize(line, cfg);
const allValid = (fields) => fields.every(isFormattedData);
void test('levelmsg: leading ISO ts -> DATE, level colors the message, URL -> LINK', () => {
    const out = tok('2026-06-12T15:30:00Z ERROR db down, see https://wiki/x for help');
    assert.ok(allValid(out));
    assert.deepEqual(out[0], { suggestStyle: 7, field: '2026-06-12T15:30:00Z', fieldType: 'DATE' });
    assert.equal(out[1]?.fieldType, 'STRING');
    assert.equal(out[1]?.suggestStyle, 6, 'ERROR -> style 6');
    const link = out.find(f => f.fieldType === 'LINK');
    assert.ok(link && typeof link.field === 'object' && link.field.location === 'https://wiki/x');
});
void test('a plain line is one STRING at style 0 (the graceful fallback)', () => {
    assert.deepEqual(tok('hello world'), [{ suggestStyle: 0, field: 'hello world', fieldType: 'STRING' }]);
});
void test('level words map to the palette anchors', () => {
    const styleOf = (lvl) => {
        const out = tok(`${lvl} something happened`);
        return out[0]?.suggestStyle;
    };
    assert.equal(styleOf('ERROR'), 6);
    assert.equal(styleOf('FATAL'), 6);
    assert.equal(styleOf('WARN'), 9);
    assert.equal(styleOf('WARNING'), 9);
    assert.equal(styleOf('INFO'), 0);
    assert.equal(styleOf('DEBUG'), 7);
    assert.equal(styleOf('TRACE'), 7);
});
void test('json: ts/level/msg promoted, the rest dimmed; numeric epoch becomes a DATE', () => {
    const out = tok(JSON.stringify({ ts: '2026-06-12T00:00:00Z', level: 'warn', msg: 'disk 80%', host: 'web1' }));
    assert.ok(allValid(out));
    assert.equal(out[0]?.fieldType, 'DATE');
    assert.deepEqual(out[1], { suggestStyle: 9, field: 'WARN', fieldType: 'STRING' });
    assert.deepEqual(out[2], { suggestStyle: 9, field: 'disk 80%', fieldType: 'STRING' });
    assert.deepEqual(out[3], { suggestStyle: 7, field: 'host=web1', fieldType: 'STRING' });
    const epoch = tok(JSON.stringify({ time: 1765000000, level: 'info', msg: 'ok' }));
    assert.equal(epoch[0]?.fieldType, 'DATE', 'numeric epoch seconds -> ISO DATE');
    const ts = epoch[0]?.field;
    assert.ok(typeof ts === 'string' && Number.isFinite(new Date(ts).getTime()));
});
void test('logfmt: key=value pairs, quoted values unwrapped', () => {
    const out = tok('level=info msg="server started" port=3000');
    assert.ok(allValid(out));
    assert.deepEqual(out[0], { suggestStyle: 0, field: 'INFO', fieldType: 'STRING' });
    assert.deepEqual(out[1], { suggestStyle: 0, field: 'server started', fieldType: 'STRING' });
    assert.deepEqual(out[2], { suggestStyle: 7, field: 'port=3000', fieldType: 'STRING' });
});
void test('syslog: timestamp, host+tag as source, message tokenized', () => {
    const out = tok('Jun 12 15:36:44 web1 sshd[1234]: WARN failed password for root');
    assert.ok(allValid(out));
    assert.equal(out[0]?.field, 'Jun 12 15:36:44');
    assert.equal(out[1]?.field, 'web1 sshd');
    assert.equal(out[1]?.suggestStyle, 2);
    assert.ok(out.some(f => typeof f.field === 'string' && f.suggestStyle === 9 && /failed password/.test(f.field)));
});
void test('a URL bearing a control char stays a STRING, never an invalid LINK', () => {
    const out = tok(`see http://evil/${String.fromCharCode(1)}bad now`);
    assert.ok(allValid(out), 'all fields valid for the server guard');
    assert.ok(!out.some(f => f.fieldType === 'LINK'), 'control-bearing URL is not emitted as a LINK');
});
void test('a non-http URL-like token is not a LINK', () => {
    const out = tok('connect to ftp://host/file');
    assert.ok(!out.some(f => f.fieldType === 'LINK'));
});
void test('an over-long line skips tokenization (ReDoS guard) and is one STRING', () => {
    const small = parseTokenizeConfig({ maxLen: 16 }, true, 't');
    const long = `ERROR ${'x'.repeat(100)} https://a/b`;
    const out = tokenize(long, small);
    assert.deepEqual(out, [{ suggestStyle: 0, field: long, fieldType: 'STRING' }]);
});
void test('user rules win, first match, whole-line', () => {
    const c = parseTokenizeConfig({ rules: [{ match: 'AUDIT', style: 6 }] }, true, 't');
    assert.deepEqual(tokenize('AUDIT user=root action=delete', c), [
        { suggestStyle: 6, field: 'AUDIT user=root action=delete', fieldType: 'STRING' }
    ]);
    assert.equal(tokenize('INFO ok', c)[0]?.field, 'INFO ok');
});
void test('raw format emits the whole line untokenized', () => {
    const c = parseTokenizeConfig({ format: 'raw' }, true, 't');
    assert.deepEqual(tokenize('2026-06-12T00:00:00Z ERROR x', c), [
        { suggestStyle: 0, field: '2026-06-12T00:00:00Z ERROR x', fieldType: 'STRING' }
    ]);
});
void test('toFields honors enabled: off -> raw whole line, on -> tokenized', () => {
    const off = parseTokenizeConfig(false, true, 't');
    assert.deepEqual(toFields('ERROR boom', off), [{ suggestStyle: 0, field: 'ERROR boom', fieldType: 'STRING' }]);
    const on = parseTokenizeConfig(true, false, 't');
    assert.equal(toFields('ERROR boom', on)[0]?.suggestStyle, 6);
});
void test('parseTokenizeConfig: defaults and validation', () => {
    assert.equal(parseTokenizeConfig(undefined, false, 't').enabled, false, 'genericSerial-style default off');
    assert.equal(parseTokenizeConfig(undefined, true, 't').enabled, true, 'logTail-style default on');
    assert.equal(parseTokenizeConfig(true, false, 't').enabled, true);
    assert.throws(() => parseTokenizeConfig({ format: 'nope' }, true, 't'), /tokenize.format/);
    assert.throws(() => parseTokenizeConfig({ enabled: 'yes' }, true, 't'), /tokenize.enabled/);
    assert.throws(() => parseTokenizeConfig({ maxLen: 0 }, true, 't'), /tokenize.maxLen/);
    assert.throws(() => parseTokenizeConfig({ rules: 'x' }, true, 't'), /tokenize.rules/);
    assert.throws(() => parseTokenizeConfig({ rules: [{ match: '(', style: 1 }] }, true, 't'), /not a valid regex/);
    assert.throws(() => parseTokenizeConfig({ rules: [{ match: 'x' }] }, true, 't'), /\.style/);
});
