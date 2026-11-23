import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFilename } from '../src/processing/filename.js';
import { extractUrl, parseLink } from '../src/processing/url.js';

describe('parseLink', () => {
  it('accepts the usual TikTok hosts and normalizes to https', () => {
    for (const raw of [
      'https://www.tiktok.com/@user/video/123',
      'http://tiktok.com/@user/video/123',
      'https://vm.tiktok.com/ZMabc/',
      'https://vt.tiktok.com/ZSabc/',
      'https://m.tiktok.com/v/123.html',
    ]) {
      const parsed = parseLink(raw);
      assert.ok(parsed, raw);
      assert.equal(parsed.service, 'tiktok');
      assert.equal(parsed.url.protocol, 'https:');
    }
  });

  it('extracts the link from a pasted share message', () => {
    const parsed = parseLink('Look at this!! https://vm.tiktok.com/ZMabc/. so good');
    assert.equal(parsed?.url.toString(), 'https://vm.tiktok.com/ZMabc/');
  });

  it('rejects look-alike hosts, other schemes, credentials and odd ports', () => {
    for (const raw of [
      '',
      'not a url',
      'https://tiktok.com.evil.example/@a/video/1',
      'https://eviltiktok.com/@a/video/1',
      'https://example.com/?u=https://tiktok.com',
      'ftp://tiktok.com/video',
      'javascript:alert(1)',
      'https://user:pass@www.tiktok.com/@a/video/1',
      'https://www.tiktok.com:8443/@a/video/1',
      `https://www.tiktok.com/${'a'.repeat(3000)}`,
    ]) {
      assert.equal(parseLink(raw), null, raw);
    }
  });
});

describe('extractUrl', () => {
  it('strips trailing punctuation', () => {
    assert.equal(extractUrl('see https://www.tiktok.com/@a/video/1!'), 'https://www.tiktok.com/@a/video/1');
  });
  it('returns null when there is no TikTok link', () => {
    assert.equal(extractUrl('https://example.com/x'), null);
  });
});

describe('createFilename', () => {
  it('keeps only safe characters', () => {
    assert.equal(createFilename('user_123', 'mp4'), 'user_123.mp4');
    assert.equal(createFilename('../../etc/passwd"\r\n', 'mp4'), 'etc_passwd.mp4');
  });
  it('falls back and truncates', () => {
    assert.equal(createFilename('###', 'mp3'), 'tiktok_video.mp3');
    assert.ok(createFilename('a'.repeat(200), 'mp4').length <= 48 + 4);
  });
});
