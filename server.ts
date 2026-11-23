import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

interface CachedDownload {
  url: string;
  filename: string;
  contentType: string;
  expiresAt: number;
}

const downloadStore = new Map<string, CachedDownload>();
const MAX_CACHE_SIZE = 200;
const CACHE_TTL_MS = 15 * 60 * 1000;

function storeDownload(url: string, filename: string, contentType: string): string {
  const now = Date.now();
  for (const [key, entry] of downloadStore) {
    if (entry.expiresAt <= now) {
      downloadStore.delete(key);
    }
  }
  while (downloadStore.size >= MAX_CACHE_SIZE) {
    const oldestKey = downloadStore.keys().next().value;
    if (!oldestKey) break;
    downloadStore.delete(oldestKey);
  }

  const token = crypto.randomBytes(18).toString('base64url');
  downloadStore.set(token, {
    url,
    filename,
    contentType,
    expiresAt: now + CACHE_TTL_MS,
  });
  return token;
}

function isAllowedTikTokUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    const valid =
      host === 'tiktok.com' ||
      host === 'www.tiktok.com' ||
      host === 'm.tiktok.com' ||
      host === 'vm.tiktok.com' ||
      host === 'vt.tiktok.com' ||
      host.endsWith('.tiktok.com');
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTikWmUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const trimmed = candidate.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `https://www.tikwm.com${trimmed}`;
  }
  return null;
}

function sanitizeFilename(base: string, ext: string): string {
  const cleaned = base
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${cleaned || 'tiktok_video'}.${ext}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.post('/api/resolve', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const parsed = isAllowedTikTokUrl(rawUrl);

    if (!parsed) {
      res.status(400).json({
        error: 'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14000);

    try {
      const formBody = new URLSearchParams({
        url: parsed.toString(),
        hd: '1',
      });

      const upstream = await fetch('https://www.tikwm.com/api/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; TikTokVideoDownloader/1.0)',
        },
        body: formBody.toString(),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        res.status(502).json({
          error: 'Could not reach the TikTok video resolver right now. Try again in a moment.',
        });
        return;
      }

      const payload = (await upstream.json()) as {
        code?: number;
        msg?: string;
        data?: {
          id?: string;
          title?: string;
          cover?: string;
          duration?: number;
          play?: string;
          hdplay?: string;
          music?: string;
          size?: number;
          hd_size?: number;
          digg_count?: number;
          play_count?: number;
          author?: {
            unique_id?: string;
            nickname?: string;
            avatar?: string;
          };
        };
      };

      if (payload.code !== 0 || !payload.data) {
        res.status(404).json({
          error: payload.msg || 'Video not found. Make sure the TikTok video is public.',
        });
        return;
      }

      const data = payload.data;
      const hdUrl = normalizeTikWmUrl(data.hdplay);
      const sdUrl = normalizeTikWmUrl(data.play);
      const audioUrl = normalizeTikWmUrl(data.music);
      const coverUrl = normalizeTikWmUrl(data.cover);

      if (!hdUrl && !sdUrl) {
        res.status(404).json({
          error: 'No downloadable video stream was found for this link.',
        });
        return;
      }

      const handle = data.author?.unique_id || 'tiktok';
      const id = data.id || String(Date.now());
      const baseName = `${handle}_${id}`;

      const hdToken = hdUrl ? storeDownload(hdUrl, sanitizeFilename(`${baseName}_hd`, 'mp4'), 'video/mp4') : null;
      const sdToken = sdUrl ? storeDownload(sdUrl, sanitizeFilename(baseName, 'mp4'), 'video/mp4') : null;
      const audioToken = audioUrl ? storeDownload(audioUrl, sanitizeFilename(baseName, 'mp3'), 'audio/mpeg') : null;
      const coverToken = coverUrl ? storeDownload(coverUrl, sanitizeFilename(`${baseName}_cover`, 'jpg'), 'image/jpeg') : null;

      res.json({
        id,
        sourceUrl: parsed.toString(),
        title: (data.title || '').trim() || 'TikTok Video',
        authorName: data.author?.nickname || handle,
        authorHandle: handle.startsWith('@') ? handle : `@${handle}`,
        duration: typeof data.duration === 'number' ? data.duration : 0,
        likeCount: typeof data.digg_count === 'number' ? data.digg_count : null,
        viewCount: typeof data.play_count === 'number' ? data.play_count : null,
        coverUrl: coverToken ? `/api/media/${coverToken}` : null,
        previewUrl: hdToken ? `/api/media/${hdToken}` : sdToken ? `/api/media/${sdToken}` : null,
        downloads: {
          hd: hdToken
            ? {
                url: `/api/file/${hdToken}`,
                sizeBytes: typeof data.hd_size === 'number' ? data.hd_size : null,
              }
            : null,
          sd: sdToken
            ? {
                url: `/api/file/${sdToken}`,
                sizeBytes: typeof data.size === 'number' ? data.size : null,
              }
            : null,
          audio: audioToken
            ? {
                url: `/api/file/${audioToken}`,
              }
            : null,
        },
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        error: aborted
          ? 'The request timed out. Check the link and try again.'
          : 'Unable to fetch that video right now. Verify the link is public and try again.',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  });

  app.get('/api/media/:token', async (req, res) => {
    const entry = downloadStore.get(req.params.token);
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).end();
      return;
    }

    try {
      const forwardHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; TikTokVideoDownloader/1.0)',
      };
      if (typeof req.headers.range === 'string') {
        forwardHeaders.Range = req.headers.range;
      }

      const upstream = await fetch(entry.url, { headers: forwardHeaders });
      if (!upstream.ok && upstream.status !== 206) {
        res.status(502).end();
        return;
      }
      if (!upstream.body) {
        res.status(502).end();
        return;
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || entry.contentType);
      res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }
      res.setHeader('Cache-Control', 'private, max-age=300');
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } catch {
      res.status(502).end();
    }
  });

  app.get('/api/file/:token', async (req, res) => {
    const entry = downloadStore.get(req.params.token);
    if (!entry || entry.expiresAt <= Date.now()) {
      res.status(404).json({ error: 'Download link expired. Paste the TikTok link again.' });
      return;
    }

    try {
      const upstream = await fetch(entry.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TikTokVideoDownloader/1.0)' },
      });
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: 'Failed to stream the video file.' });
        return;
      }

      res.setHeader('Content-Type', upstream.headers.get('content-type') || entry.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } catch {
      res.status(502).json({ error: 'Download stream interrupted. Please try again.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
