import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeMediaUrl, isPublicAddress } from '../lib/guard.ts';

describe('isPublicAddress', () => {
  it('blocks loopback, private, link-local and metadata addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  it('treats anything that is not an ip as not public', () => {
    assert.equal(isPublicAddress('example.com'), false);
  });
});

describe('assertSafeMediaUrl', () => {
  it('accepts ordinary https media urls', () => {
    assert.doesNotThrow(() => assertSafeMediaUrl(new URL('https://cdn.example.com/a.mp4')));
    assert.doesNotThrow(() => assertSafeMediaUrl(new URL('http://cdn.example.com:80/a.mp4')));
  });

  it('rejects dangerous destinations', () => {
    for (const raw of [
      'file:///etc/passwd',
      'ftp://cdn.example.com/a',
      'http://localhost/a',
      'http://foo.localhost/a',
      'http://metadata.google.internal/a',
      'http://127.0.0.1/a',
      'http://[::1]/a',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:7f00:1]/a',
      'https://user:pw@cdn.example.com/a',
      'https://cdn.example.com:6379/a',
    ]) {
      assert.throws(() => assertSafeMediaUrl(new URL(raw)), raw);
    }
  });
});
