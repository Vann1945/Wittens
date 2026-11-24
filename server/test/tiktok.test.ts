import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { createApp, errorHandler } from '../app.ts';
import { loadConfig, type Config } from '../config.ts';
import {
  decodeToken,
  encodeToken,
  findLive,
  isMediaHost,
  isPageHost,
  normalize,
  videoQualities,
  type RawFetcher,
} from '../lib/tiktok.ts';

interface TestServer {
  base: string;
  close: () => Promise<void>;
}

async function startTestServer(options: {
  tiktokFetcher?: RawFetcher;
  config?: Partial<Config>;
} = {}): Promise<TestServer> {
  const config: Config = {
    ...loadConfig({}),
    isProd: true,
    webDistPath: null,
    ...options.config,
  };
  const app = createApp({ config, version: '1.0.0-test', tiktokFetcher: options.tiktokFetcher });
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('tiktok host allowlists and signed tokens', () => {
  it('allows only expected page and media hosts', () => {
    assert.equal(isPageHost('www.tiktok.com'), true);
    assert.equal(isPageHost('vm.tiktok.com'), true);
    assert.equal(isPageHost('tiktok.com.evil.test'), false);

    assert.equal(isMediaHost('v16-webapp-prime.tiktokcdn.com'), true);
    assert.equal(isMediaHost('p16-sign.ibyteimg.com'), true);
    assert.equal(isMediaHost('v16m.akamaized.net'), true);
    assert.equal(isMediaHost('127.0.0.1'), false);
    assert.equal(isMediaHost('evil.example.com'), false);
  });

  it('signs and verifies media tokens and rejects tampering', () => {
    const token = encodeToken({ u: 'https://v16.tiktokcdn.com/video.mp4', c: 'tt_chain_token=abc' });
    const decoded = decodeToken(token);
    assert.equal(decoded.u, 'https://v16.tiktokcdn.com/video.mp4');
    assert.equal(decoded.c, 'tt_chain_token=abc');

    const tampered = `${token.slice(0, -2)}xx`;
    assert.throws(() => decodeToken(tampered));
    assert.throws(() =>
      decodeToken(Buffer.from(JSON.stringify({ u: 'https://v16.tiktokcdn.com/a.mp4' })).toString('base64url')),
    );
  });
});

describe('videoQualities, findLive, and normalize', () => {
  it('sorts video qualities by resolution, prefers H.264 over HEVC, then bitrate', () => {
    const qualities = videoQualities({
      bitrateInfo: [
        {
          Bitrate: 2_000_000,
          CodecType: 'h265_hvc1',
          PlayAddr: {
            Width: 1080,
            Height: 1920,
            DataSize: 900,
            UrlList: ['https://v16.tiktokcdn.com/1080_hevc.mp4'],
          },
        },
        {
          Bitrate: 1_200_000,
          CodecType: 'h264',
          PlayAddr: {
            Width: 720,
            Height: 1280,
            DataSize: 500,
            UrlList: ['https://v16.tiktokcdn.com/720_h264.mp4'],
          },
        },
        {
          Bitrate: 1_800_000,
          CodecType: 'h264',
          PlayAddr: {
            Width: 1080,
            Height: 1920,
            DataSize: 800,
            UrlList: ['https://v16.tiktokcdn.com/1080_h264.mp4'],
          },
        },
      ],
    });
    assert.equal(qualities.length, 3);
    assert.equal(qualities[0]?.url, 'https://v16.tiktokcdn.com/1080_h264.mp4');
    assert.equal(qualities[1]?.url, 'https://v16.tiktokcdn.com/1080_hevc.mp4');
    assert.equal(qualities[2]?.url, 'https://v16.tiktokcdn.com/720_h264.mp4');
  });

  it('finds live photo video urls inside photo items', () => {
    const liveUrl = findLive({
      imageURL: { urlList: ['https://p16.ibyteimg.com/photo.jpeg'] },
      livePhotoInfo: { videoUrl: { urlList: ['https://v16.tiktokcdn.com/live.mp4'] } },
    });
    assert.equal(liveUrl, 'https://v16.tiktokcdn.com/live.mp4');
  });

  it('normalizes photo slideshows with live photos and music', () => {
    const wrap = (u: string, n: string) => ({
      dl: `/api/dl?u=${u}&n=${n}`,
      src: `/api/dl?u=${u}&n=${n}&inline=1`,
    });
    const info = normalize(
      {
        id: '999',
        desc: 'Photo dump #sunset',
        author: { uniqueId: 'alice', nickname: 'Alice', verified: true },
        statsV2: {
          playCount: '1200',
          diggCount: '300',
          commentCount: '12',
          shareCount: '4',
          collectCount: '25',
        },
        music: {
          title: 'Chill Beat',
          authorName: 'DJ',
          duration: 30,
          playUrl: 'https://sf16.muscdn.com/audio.mp3',
        },
        imagePost: {
          images: [
            {
              imageWidth: 1080,
              imageHeight: 1440,
              imageURL: {
                urlList: ['https://p16.ibyteimg.com/1.webp', 'https://p16.ibyteimg.com/1.jpeg'],
              },
              liveVideo: { urlList: ['https://v16.tiktokcdn.com/1_live.mp4'] },
            },
          ],
        },
      },
      wrap,
      'https://www.tiktok.com/@alice/photo/999',
    );
    assert.equal(info.type, 'photo');
    assert.equal(info.video, null);
    assert.equal(info.images.length, 1);
    assert.match(info.images[0]!.dl, /1\.jpeg/);
    assert.ok(info.images[0]!.live);
    assert.equal(info.music?.title, 'Chill Beat');
    assert.equal(info.stats.likes, 300);
  });
});

describe('API routes (/api, /api/info, /api/dl)', () => {
  it('returns health info and security headers on GET /api', async () => {
    server = await startTestServer();
    const res = await fetch(`${server.base}/api`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    const body = (await res.json()) as { wittens: { version: string; provider: string } };
    assert.equal(body.wittens.version, '1.0.0-test');
    assert.equal(body.wittens.provider, 'tiktok');
  });

  it('extracts SSR __UNIVERSAL_DATA_FOR_REHYDRATION__, passes session cookies, and streams via /api/dl', async () => {
    let seenMediaCookie = '';
    let seenMediaReferer = '';
    const tiktokFetcher: RawFetcher = async (url, init) => {
      const href = String(url);
      if (href.startsWith('https://www.tiktok.com/')) {
        const payload = {
          __DEFAULT_SCOPE__: {
            'webapp.video-detail': {
              itemInfo: {
                itemStruct: {
                  id: '7300000000000000002',
                  desc: 'Cool clip #fyp',
                  createTime: 1700000000,
                  author: { uniqueId: 'creator', nickname: 'Creator', verified: false },
                  stats: {
                    playCount: 5000,
                    diggCount: 400,
                    commentCount: 10,
                    shareCount: 5,
                    collectCount: 20,
                  },
                  video: {
                    duration: 15,
                    cover: 'https://p16.ibyteimg.com/cover.jpg',
                    bitrateInfo: [
                      {
                        Bitrate: 1500000,
                        CodecType: 'h264',
                        PlayAddr: {
                          Width: 720,
                          Height: 1280,
                          DataSize: 4096,
                          UrlList: ['https://v16.tiktokcdn.com/clip_720.mp4'],
                        },
                      },
                    ],
                  },
                  music: {
                    title: 'Sound',
                    authorName: 'Creator',
                    duration: 15,
                    playUrl: 'https://sf16.muscdn.com/sound.mp3',
                  },
                },
              },
            },
          },
        };
        return new Response(
          `<!doctype html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script>`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie': 'tt_chain_token=secret123; Path=/; HttpOnly',
            },
          },
        );
      }

      if (href === 'https://v16.tiktokcdn.com/clip_720.mp4') {
        seenMediaCookie = init?.headers?.Cookie ?? '';
        seenMediaReferer = init?.headers?.Referer ?? '';
        if (init?.headers?.Range) {
          return new Response('mp', {
            status: 206,
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': '2',
              'Content-Range': 'bytes 0-1/4',
              'Accept-Ranges': 'bytes',
            },
          });
        }
        return new Response('mp4!', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': '4' },
        });
      }

      return new Response('not found', { status: 404 });
    };

    server = await startTestServer({ tiktokFetcher });

    const infoRes = await fetch(
      `${server.base}/api/info?url=${encodeURIComponent('https://www.tiktok.com/@creator/video/7300000000000000002')}`,
    );
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.type, 'video');
    assert.equal(info.id, '7300000000000000002');
    assert.equal(info.video.qualities.length, 1);
    assert.match(info.video.dl, /^\/api\/dl\?t=/);

    // Inline range streaming
    const streamRes = await fetch(`${server.base}${info.video.src}`, {
      headers: { Range: 'bytes=0-1' },
    });
    assert.equal(streamRes.status, 206);
    assert.equal(await streamRes.text(), 'mp');
    assert.equal(seenMediaCookie, 'tt_chain_token=secret123');
    assert.equal(seenMediaReferer, 'https://www.tiktok.com/');
    assert.match(streamRes.headers.get('content-disposition') ?? '', /^inline;/);

    // Attachment download
    const dlRes = await fetch(`${server.base}${info.video.dl}`);
    assert.equal(dlRes.status, 200);
    assert.equal(await dlRes.text(), 'mp4!');
    assert.match(
      dlRes.headers.get('content-disposition') ?? '',
      /^attachment; filename="tiktok_creator_7300000000000000002_720p\.mp4"$/,
    );
  });

  it('rejects unsigned tokens and forces attachment + octet-stream for hostile upstream MIME types', async () => {
    const tiktokFetcher: RawFetcher = async () =>
      new Response('<script>alert(1)</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

    server = await startTestServer({ tiktokFetcher });

    const badTokenRes = await fetch(`${server.base}/api/dl?t=unsigned_junk`);
    assert.equal(badTokenRes.status, 400);

    const signedToken = encodeToken({ u: 'https://v16.tiktokcdn.com/fake.html' });
    const htmlRes = await fetch(`${server.base}/api/dl?t=${signedToken}&n=test&inline=1`);
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get('content-type'), 'application/octet-stream');
    assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
    assert.match(htmlRes.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  it('enforces rate limiting and returns 404 for unknown API paths', async () => {
    server = await startTestServer({ config: { infoRateLimitMax: 1 } });

    const notFound = await fetch(`${server.base}/api/does-not-exist`);
    assert.equal(notFound.status, 404);

    const first = await fetch(`${server.base}/api/info?url=not-valid`);
    assert.equal(first.status, 400);
    const second = await fetch(`${server.base}/api/info?url=not-valid`);
    assert.equal(second.status, 429);
  });
});
