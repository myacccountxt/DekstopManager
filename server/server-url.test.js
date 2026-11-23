const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeServerUrl } = require('../shared/server-url');

test('server URL allows LAN HTTP and public HTTPS only', () => {
  assert.equal(normalizeServerUrl('http://192.168.1.12:3000'), 'http://192.168.1.12:3000');
  assert.equal(normalizeServerUrl('http://[::1]:3000'), 'http://[::1]:3000');
  assert.equal(normalizeServerUrl('https://archive.example.org/path'), 'https://archive.example.org');
  assert.throws(() => normalizeServerUrl('http://archive.example.org'), /gunakan alamat HTTPS/);
  assert.throws(() => normalizeServerUrl('file:///tmp/archive'), /HTTP atau HTTPS/);
  assert.throws(() => normalizeServerUrl('https://user:pass@archive.example.org'), /tidak boleh berisi kredensial/);
});
