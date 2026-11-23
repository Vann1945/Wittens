import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { errors } from '../src/processing/errors.js';
import type { Fetcher } from '../src/stream/fetcher.js';
import { fakeProvider, postResolve, startTestServer, type TestServer } from './helpers.js';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const VALID = 'https://www.tiktok.com/@someauthor/video/7300000000000000001';

function tokenOf(url: string): string {
  return url.split('/').pop()!;
}

describe('GET /api', () => {
  it('returns instance info', async () => {
    server = await startTestServer();
    const body = await (await fetch(`${server.base}/api`)).json();
    assert.equal(body.wittens.version, '0.0.0-test');
    assert.equal(body.wittens.provider, 'fake');
    assert.deepEqual(body.wittens.services, ['tiktok']);
  });

  it('sends hardening headers and no x-powered-by', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.base}/api`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  });
});

describe('POST /api/resolve', () => {
  it('resolves a link into tunnel urls that never expose upstream hosts', async () => {
    server = await startTestServer();
    const res = await postResolve(server.base, { url: VALID });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const { status, video } = await res.json();
    assert.equal(status, 'ok');
    assert.equal(video.id, '7300000000000000001');
    assert.equal(video.sourceUrl, VALID);
    assert.match(video.downloads.hd.url, /^\/api\/tunnel\/[\w-]{24}$/);
    assert.match(video.downloads.sd.url, /^\/api\/tunnel\/[\w-]{24}$/);
    assert.match(video.downloads.audio.url, /^\/api\/tunnel\/[\w-]{24}$/);
    assert.match(video.previewUrl, /^\/api\/stream\/[\w-]{24}$/);
    assert.match(video.coverUrl, /^\/api\/stream\/[\w-]{24}$/);
    assert.equal(video.downloads.hd.sizeBytes, 2048);
    assert.doesNotMatch(JSON.stringify(video), /cdn\.test/);
  });

  it('prefers hd for preview and falls back to sd', async () => {
    server = await startTestServer({
      provider: fakeProvider({
        id: '1', title: 't', authorName: 'a', authorHandle: '@a', duration: 1,
        likeCount: null, viewCount: null, cover: null, hd: null, audio: null,
        sd: { url: 'https://cdn.test/sd.mp4' },
      }),
    });
    const { video } = await (await postResolve(server.base, { url: VALID })).json();
    assert.equal(video.downloads.hd, null);
    assert.equal(tokenOf(video.previewUrl), tokenOf(video.downloads.sd.url));
    assert.equal(video.coverUrl, null);
  });

  it('rejects invalid links with a stable error shape', async () => {
    server = await startTestServer();
    for (const url of ['https://example.com/video', 'https://tiktok.com.evil.test/a', '']) {
      const res = await postResolve(server.base, { url });
      assert.equal(res.status, 400, url);
      const body = await res.json();
      assert.equal(body.status, 'error');
      assert.equal(body.error.code, 'error.link.invalid');
    }
  });

  it('rejects malformed bodies and wrong content types', async () => {
    server = await startTestServer();
    assert.equal((await postResolve(server.base, { url: 42 })).status, 400);
    assert.equal((await postResolve(server.base, '{nope')).status, 400);
    assert.equal((await postResolve(server.base, { url: 'x'.repeat(40_000) })).status, 413);

    const wrongType = await fetch(`${server.base}/api/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: VALID,
    });
    assert.equal(wrongType.status, 415);
  });

  it('passes provider errors through with their status', async () => {
    server = await startTestServer({ provider: fakeProvider(errors.videoNotFound()) });
    const res = await postResolve(server.base, { url: VALID });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'error.video.not_found');
  });

  it('hides unexpected failures behind a generic 500', async () => {
    server = await startTestServer({ provider: fakeProvider(new Error('secret internal detail')) });
    const res = await postResolve(server.base, { url: VALID });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /secret/);
    assert.equal(JSON.parse(text).error.code, 'error.internal');
  });

  it('rate limits per client', async () => {
    server = await startTestServer({ config: { rateLimitMax: 2 } });
    assert.equal((await postResolve(server.base, { url: VALID })).status, 200);
    assert.equal((await postResolve(server.base, { url: VALID })).status, 200);
    const limited = await postResolve(server.base, { url: VALID });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'error.rate_exceeded');
  });
});

describe('tunnels', () => {
  const mediaFetcher: Fetcher = async (url, init) => {
    assert.equal(url, 'https://cdn.test/hd.mp4');
    const range = init?.headers?.Range;
    if (range) {
      return new Response('lo', {
        status: 206,
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': '2',
          'Content-Range': 'bytes 0-1/5',
        },
      });
    }
    return new Response('hello', {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Content-Length': '5' },
    });
  };

  async function resolveTokens(s: TestServer) {
    const { video } = await (await postResolve(s.base, { url: VALID })).json();
    return video as {
      previewUrl: string;
      downloads: { hd: { url: string } };
    };
  }

  it('downloads as an attachment with a safe name and forced content type', async () => {
    server = await startTestServer({ mediaFetcher });
    const video = await resolveTokens(server);
    const res = await fetch(`${server.base}${video.downloads.hd.url}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'hello');
    assert.equal(res.headers.get('content-type'), 'video/mp4'); // never the upstream text/html
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="someauthor_7300000000000000001_hd.mp4"');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('streams inline and forwards byte ranges for seeking', async () => {
    server = await startTestServer({ mediaFetcher });
    const video = await resolveTokens(server);
    const res = await fetch(`${server.base}${video.previewUrl}`, { headers: { Range: 'bytes=0-1' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'lo');
    assert.equal(res.headers.get('content-range'), 'bytes 0-1/5');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(res.headers.get('content-disposition'), null);
  });

  it('answers 404 for unknown, malformed and expired tokens', async () => {
    let now = 0;
    server = await startTestServer({ mediaFetcher, now: () => now, config: { tunnelTtlMs: 1000 } });
    const video = await resolveTokens(server);

    const unknown = await fetch(`${server.base}/api/tunnel/${'A'.repeat(24)}`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'error.tunnel.expired');

    assert.equal((await fetch(`${server.base}/api/tunnel/not-a-token`)).status, 404);
    assert.equal((await fetch(`${server.base}/api/stream/not-a-token`)).status, 404);

    now += 1001;
    assert.equal((await fetch(`${server.base}${video.downloads.hd.url}`)).status, 404);
    assert.equal((await fetch(`${server.base}${video.previewUrl}`)).status, 404);
  });

  it('turns upstream failures into clean errors', async () => {
    server = await startTestServer({
      mediaFetcher: async () => new Response('nope', { status: 403 }),
    });
    const video = await resolveTokens(server);
    const download = await fetch(`${server.base}${video.downloads.hd.url}`);
    assert.equal(download.status, 502);
    assert.equal((await download.json()).error.code, 'error.tunnel.failed');
    assert.equal((await fetch(`${server.base}${video.previewUrl}`)).status, 502);
  });

  it('turns blocked or failing upstream fetches into 502', async () => {
    server = await startTestServer({
      mediaFetcher: async () => {
        throw new Error('blocked address');
      },
    });
    const video = await resolveTokens(server);
    assert.equal((await fetch(`${server.base}${video.downloads.hd.url}`)).status, 502);
  });
});

describe('routing and cors', () => {
  it('returns json 404 for unknown api routes', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.base}/api/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'error.not_found');
  });

  it('sends no cors headers by default', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.base}/api`, { headers: { Origin: 'https://other.test' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('answers preflight for the configured origin', async () => {
    server = await startTestServer({ config: { corsOrigin: 'https://app.test' } });
    const res = await fetch(`${server.base}/api/resolve`, { method: 'OPTIONS', headers: { Origin: 'https://app.test' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  });
});
