import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../src/processing/errors.js';
import { createTikWmProvider } from '../src/processing/providers/tikwm.js';
import type { Fetcher } from '../src/stream/fetcher.js';

const link = new URL('https://www.tiktok.com/@user/video/1');
const signal = new AbortController().signal;

function providerWith(fetcher: Fetcher) {
  return createTikWmProvider({ apiUrl: 'https://www.tikwm.com/api/', fetcher, userAgent: 'test' });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected ApiError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected a rejection');
}

describe('tikwm provider', () => {
  it('maps a successful payload and absolutizes relative urls', async () => {
    let sentBody = '';
    const provider = providerWith(async (_url, init) => {
      sentBody = String(init?.body);
      return json({
        code: 0,
        data: {
          id: '42',
          title: '  Nice video ',
          cover: '/cover.jpg',
          duration: 9,
          play: '/video/sd.mp4',
          hdplay: 'https://cdn.example.com/hd.mp4',
          music: '/music.mp3',
          size: 100,
          hd_size: 200,
          digg_count: 5,
          play_count: 50,
          author: { unique_id: 'someone', nickname: 'Some One' },
        },
      });
    });

    const result = await provider.resolve(link, signal);

    assert.match(sentBody, /url=https%3A%2F%2Fwww\.tiktok\.com/);
    assert.match(sentBody, /hd=1/);
    assert.equal(result.title, 'Nice video');
    assert.equal(result.authorHandle, '@someone');
    assert.equal(result.hd?.url, 'https://cdn.example.com/hd.mp4');
    assert.equal(result.hd?.sizeBytes, 200);
    assert.equal(result.sd?.url, 'https://www.tikwm.com/video/sd.mp4');
    assert.equal(result.audio?.url, 'https://www.tikwm.com/music.mp3');
    assert.equal(result.cover?.url, 'https://www.tikwm.com/cover.jpg');
  });

  it('ignores protocol-relative and non-http urls', async () => {
    const provider = providerWith(async () =>
      json({
        code: 0,
        data: { id: '1', play: 'https://cdn.example.com/a.mp4', music: '//evil.example/a.mp3', cover: 'javascript:1' },
      }),
    );
    const result = await provider.resolve(link, signal);
    assert.equal(result.audio, null);
    assert.equal(result.cover, null);
  });

  it('reports upstream rate limiting distinctly', async () => {
    const limited = providerWith(async () => json({ code: -1, msg: 'Free Api Limit: 1 request/second.' }));
    assert.equal(await codeOf(limited.resolve(link, signal)), 'error.provider.rate_limited');

    const http429 = providerWith(async () => json({}, 429));
    assert.equal(await codeOf(http429.resolve(link, signal)), 'error.provider.rate_limited');
  });

  it('maps missing videos, missing streams, bad responses and timeouts', async () => {
    const notFound = providerWith(async () => json({ code: -1, msg: 'Url parsing is failed!' }));
    assert.equal(await codeOf(notFound.resolve(link, signal)), 'error.video.not_found');

    const noStream = providerWith(async () => json({ code: 0, data: { id: '1' } }));
    assert.equal(await codeOf(noStream.resolve(link, signal)), 'error.video.no_stream');

    const http500 = providerWith(async () => json({}, 500));
    assert.equal(await codeOf(http500.resolve(link, signal)), 'error.provider.unreachable');

    const notJson = providerWith(async () => new Response('<html>', { status: 200 }));
    assert.equal(await codeOf(notJson.resolve(link, signal)), 'error.provider.unreachable');

    const aborted = providerWith(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    assert.equal(await codeOf(aborted.resolve(link, signal)), 'error.provider.timeout');
  });
});
