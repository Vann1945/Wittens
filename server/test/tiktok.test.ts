import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createApp } from '../app.ts';
import {
  decodeToken,
  encodeToken,
  findLive,
  isMediaHost,
  isPageHost,
  normalize,
  videoQualities,
  type RawFetcher,
} from '../lib/tiktok.js';

async function withServer(
  tiktokFetcher: RawFetcher,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = createApp({ isProd: false, version: '1.0.0-test', tiktokFetcher });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('tiktok scraper helpers', () => {
  it('validates allowed page and media hosts', () => {
    assert.equal(isPageHost('www.tiktok.com'), true);
    assert.equal(isPageHost('vm.tiktok.com'), true);
    assert.equal(isPageHost('tiktok.com'), true);
    assert.equal(isPageHost('evil-tiktok.com'), false);
    assert.equal(isPageHost('127.0.0.1'), false);

    assert.equal(isMediaHost('v16-webapp-prime.tiktok.com'), true);
    assert.equal(isMediaHost('p16-sign-sg.tiktokcdn.com'), true);
    assert.equal(isMediaHost('v19.akamaized.net'), true);
    assert.equal(isMediaHost('www.tikwm.com'), true);
    assert.equal(isMediaHost('169.254.169.254'), false);
    assert.equal(isMediaHost('localhost'), false);
  });

  it('encodes and decodes media tokens cleanly', () => {
    const token = encodeToken({ u: 'https://v16.tiktokcdn.com/video.mp4', c: 'tt_chain_token=abc' });
    const decoded = decodeToken(token);
    assert.equal(decoded.u, 'https://v16.tiktokcdn.com/video.mp4');
    assert.equal(decoded.c, 'tt_chain_token=abc');
  });

  it('orders video qualities by resolution, H.264 before HEVC, then bitrate', () => {
    const qualities = videoQualities({
      bitrateInfo: [
        {
          Bitrate: 1_500_000,
          CodecType: 'h265_hvc1',
          PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/1080-hevc.mp4'], Width: 1080, Height: 1920, DataSize: 3000 },
        },
        {
          Bitrate: 1_200_000,
          CodecType: 'h264',
          PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/1080-h264.mp4'], Width: 1080, Height: 1920, DataSize: 3500 },
        },
        {
          Bitrate: 2_000_000,
          CodecType: 'h264',
          PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/720-h264.mp4'], Width: 720, Height: 1280, DataSize: 2000 },
        },
      ],
    });

    assert.equal(qualities[0]?.url, 'https://v16.tiktokcdn.com/1080-h264.mp4');
    assert.equal(qualities[1]?.url, 'https://v16.tiktokcdn.com/1080-hevc.mp4');
    assert.equal(qualities[2]?.url, 'https://v16.tiktokcdn.com/720-h264.mp4');
  });

  it('extracts live photo URLs and normalizes photo posts', () => {
    const liveUrl = findLive({
      imageURL: { urlList: ['https://p16.tiktokcdn.com/photo.jpg'] },
      livePhotoVideo: { playAddr: 'https://v16.tiktokcdn.com/live.mp4' },
    });
    assert.equal(liveUrl, 'https://v16.tiktokcdn.com/live.mp4');

    const normalized = normalize(
      {
        id: '777',
        desc: 'Photo dump #sunset',
        author: { uniqueId: 'alice', nickname: 'Alice', verified: true },
        stats: { playCount: 1000, diggCount: 250 },
        imagePost: {
          images: [
            {
              imageWidth: 1080,
              imageHeight: 1440,
              imageURL: { urlList: ['https://p16.tiktokcdn.com/slide1.jpeg'] },
              liveVideo: { url: 'https://v16.tiktokcdn.com/slide1.mp4' },
            },
          ],
        },
        music: {
          title: 'Ambient',
          authorName: 'DJ',
          duration: 15,
          playUrl: 'https://sf16.tiktokcdn.com/audio.mp3',
        },
      },
      (url, name) => ({ dl: `/api/dl?u=${encodeURIComponent(url)}&n=${name}`, src: `/api/dl?u=${encodeURIComponent(url)}&n=${name}&inline=1` }),
      'https://www.tiktok.com/@alice/photo/777',
    );

    assert.equal(normalized.type, 'photo');
    assert.equal(normalized.images.length, 1);
    assert.ok(normalized.images[0]?.live?.dl.includes('tiktok_alice_777_01_live'));
    assert.equal(normalized.music?.title, 'Ambient');
  });
});

describe('Express API routes', () => {
  it('serves /api health, /api/info scraper response, and /api/dl media streaming', async () => {
    const rehydration = {
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              id: '123456',
              desc: 'Test clip #demo',
              createTime: 1700000000,
              author: { uniqueId: 'creator', nickname: 'Creator' },
              statsV2: { playCount: '9000', diggCount: '420' },
              video: {
                duration: 12,
                originCover: 'https://p16.tiktokcdn.com/cover.jpg',
                bitrateInfo: [
                  {
                    Bitrate: 1_000_000,
                    CodecType: 'h264',
                    PlayAddr: {
                      UrlList: ['https://v16.tiktokcdn.com/clip.mp4'],
                      Width: 720,
                      Height: 1280,
                      DataSize: 12345,
                    },
                  },
                ],
              },
              music: {
                title: 'Beat',
                authorName: 'Producer',
                duration: 12,
                playUrl: 'https://sf16.tiktokcdn.com/beat.mp3',
              },
            },
          },
        },
      },
    };

    const fakeFetcher: RawFetcher = async (input) => {
      const target = String(input);
      if (target.includes('www.tiktok.com')) {
        return new Response(
          `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(rehydration)}</script></html>`,
          {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': 'tt_chain_token=secret123; Path=/; HttpOnly',
            },
          },
        );
      }
      if (target.includes('clip.mp4')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '4',
            'accept-ranges': 'bytes',
          },
        });
      }
      if (target.includes('evil-html')) {
        return new Response('<script>alert(1)</script>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('not found', { status: 404 });
    };

    await withServer(fakeFetcher, async (baseUrl) => {
      const healthRes = await fetch(`${baseUrl}/api`);
      assert.equal(healthRes.status, 200);
      const health = (await healthRes.json()) as { ok: boolean; scraper: string };
      assert.equal(health.ok, true);
      assert.equal(health.scraper, 'tiktok');

      const infoRes = await fetch(
        `${baseUrl}/api/info?url=${encodeURIComponent('https://www.tiktok.com/@creator/video/123456')}`,
      );
      assert.equal(infoRes.status, 200);
      const info = (await infoRes.json()) as {
        id: string;
        type: string;
        video: { dl: string; src: string };
        cover: { src: string };
        music: { dl: string };
      };
      assert.equal(info.id, '123456');
      assert.equal(info.type, 'video');
      assert.ok(info.video.dl.startsWith('/api/dl?'));
      assert.ok(info.cover.src.includes('inline=1'));
      assert.ok(info.music.dl.startsWith('/api/dl?'));

      const dlRes = await fetch(`${baseUrl}${info.video.dl}`);
      assert.equal(dlRes.status, 200);
      assert.equal(dlRes.headers.get('content-type'), 'video/mp4');
      assert.equal(dlRes.headers.get('content-length'), '4');
      assert.ok(dlRes.headers.get('x-filename')?.endsWith('.mp4'));
      assert.equal((await dlRes.arrayBuffer()).byteLength, 4);

      // Non-media upstream content-type is forced to attachment + application/octet-stream
      const htmlToken = encodeToken({ u: 'https://p16.tiktokcdn.com/evil-html' });
      const guardedRes = await fetch(`${baseUrl}/api/dl?t=${htmlToken}&n=test&inline=1`);
      assert.equal(guardedRes.status, 200);
      assert.equal(guardedRes.headers.get('content-type'), 'application/octet-stream');
      assert.ok(guardedRes.headers.get('content-disposition')?.startsWith('attachment;'));

      // SSRF host rejected
      const ssrfToken = encodeToken({ u: 'https://127.0.0.1/secret' });
      const ssrfRes = await fetch(`${baseUrl}/api/dl?t=${ssrfToken}&n=secret`);
      assert.equal(ssrfRes.status, 400);
    });
  });

  it('falls back cleanly when TikTok serves SlardarWAF challenge HTML', async () => {
    const fakeFetcher: RawFetcher = async (input) => {
      const host = new URL(String(input)).hostname;
      if (host === 'www.tiktok.com') {
        return new Response('<!DOCTYPE html><script id="slardar-config">{"slardarClient":"SlardarWAF"}</script>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (host === 'www.tikwm.com') {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'success',
            data: {
              id: '7106594312292453675',
              title: 'Fallback clip #test',
              duration: 24,
              play_count: 500000,
              digg_count: 90000,
              cover: 'https://p16-common-sign.tiktokcdn-us.com/cover.jpg',
              hdplay: 'https://v19-notes.tiktokcdn-us.com/hd.mp4',
              play: 'https://v19.tiktokcdn-us.com/sd.mp4',
              music: 'https://v16-ies-music.tiktokcdn-us.com/sound.mp3',
              author: { unique_id: 'tiktok', nickname: 'TikTok' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    await withServer(fakeFetcher, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/info?url=${encodeURIComponent('https://www.tiktok.com/@tiktok/video/7106594312292453675')}`,
      );
      assert.equal(res.status, 200);
      const info = (await res.json()) as {
        id: string;
        type: string;
        video: { qualities: { dl: string }[] };
        cover: { src: string };
        music: { dl: string };
      };
      assert.equal(info.id, '7106594312292453675');
      assert.equal(info.type, 'video');
      assert.equal(info.video.qualities.length, 2);
      assert.ok(info.cover.src.startsWith('/api/dl?'));
      assert.ok(info.music.dl.startsWith('/api/dl?'));
    });
  });
});
