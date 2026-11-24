import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCaptionAndHashtags, truncateAtWord } from './caption';

describe('parseCaptionAndHashtags', () => {
  it('extracts unique hashtags case-insensitively and cleans the caption', () => {
    const result = parseCaptionAndHashtags(
      'Check out this frog! #Minecraft #gaming #minecraft\n\n\nSo cool',
    );
    assert.deepEqual(result.hashtags, ['#Minecraft', '#gaming']);
    assert.equal(result.caption, 'Check out this frog!\n\nSo cool');
  });

  it('handles captions without hashtags', () => {
    const result = parseCaptionAndHashtags('Just a plain video caption');
    assert.deepEqual(result.hashtags, []);
    assert.equal(result.caption, 'Just a plain video caption');
  });
});

describe('truncateAtWord', () => {
  it('returns short text untouched', () => {
    assert.equal(truncateAtWord('Short caption', 50), 'Short caption');
  });

  it('truncates at a word boundary and strips trailing punctuation', () => {
    const text = 'Ready for a fun challenge, scramble up your name and I will try to guess it';
    const truncated = truncateAtWord(text, 35);
    assert.equal(truncated, 'Ready for a fun challenge');
  });
});
