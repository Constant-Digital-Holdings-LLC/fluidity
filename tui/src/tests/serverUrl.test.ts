import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServerUrl } from '../modules/serverUrl.js';

void test('a full URL is preserved (scheme, host, port)', () => {
    assert.equal(normalizeServerUrl('https://localhost:3000').href, 'https://localhost:3000/');
    assert.equal(normalizeServerUrl('http://example.com:8080').href, 'http://example.com:8080/');
});

void test('a scheme-less host defaults to https - and "host:port" is not mistaken for a scheme', () => {
    assert.equal(normalizeServerUrl('localhost:3000').href, 'https://localhost:3000/');
    assert.equal(normalizeServerUrl('f-y.io').href, 'https://f-y.io/');
    assert.equal(normalizeServerUrl('192.168.1.5:3000').href, 'https://192.168.1.5:3000/');
});

void test('forgiving: trims whitespace, drops a stray leading "//", tolerates a trailing slash', () => {
    assert.equal(normalizeServerUrl('  https://host:3000/  ').href, 'https://host:3000/');
    assert.equal(normalizeServerUrl('//localhost:3000').href, 'https://localhost:3000/');
    assert.equal(normalizeServerUrl('localhost:3000/').href, 'https://localhost:3000/');
});

void test('an explicit http scheme is kept (not forced to https)', () => {
    assert.equal(normalizeServerUrl('http://localhost:3000').protocol, 'http:');
    assert.equal(normalizeServerUrl('HTTP://localhost').protocol, 'http:', 'scheme is case-insensitive');
});

void test('a path on the base is preserved but endpoints are built from the origin', () => {
    //transport uses new URL("/FIFO", base), so a path here is harmless
    const u = normalizeServerUrl('https://host:3000/some/path');
    assert.equal(new URL('/FIFO', u).href, 'https://host:3000/FIFO');
});

void test('rejects empty, junk, and non-http(s) schemes with a clear message', () => {
    assert.throws(() => normalizeServerUrl(''), /empty/);
    assert.throws(() => normalizeServerUrl('   '), /empty/);
    assert.throws(() => normalizeServerUrl('ftp://host'), /unsupported server URL scheme "ftp"/);
    assert.throws(() => normalizeServerUrl('ws://host'), /use http or https/);
    assert.throws(() => normalizeServerUrl('http://'), /invalid server URL/);
});
