import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response as ExpressResponse } from 'express';
import {
  CRAWLER_UA,
  HttpError,
  UA,
  decodeToken,
  fetchFollow,
  isMediaHost,
  type RawFetcher,
} from '../lib/tiktok.ts';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
};

const SAFE_MEDIA_TYPES = new Set<string>([...Object.keys(EXT), 'application/octet-stream']);
const RANGE_PATTERN = /^bytes=\d*-\d*(?:,\s*\d*-\d*)*$/i;

function sanitizeName(raw: unknown): string {
  const cleaned = String(raw || 'tiktok')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return cleaned || 'tiktok';
}

export interface HandleDownloadOptions {
  fetcher?: RawFetcher;
  timeoutMs?: number;
}

/**
 * Express handler for GET /api/dl?t=<signedToken>&n=<filename>[&inline=1].
 * Proxies TikTok CDN media with session cookies, Referer, Range support, and
 * strict host/MIME validation.
 */
export async function handleDownload(
  req: Request,
  res: ExpressResponse,
  options: HandleDownloadOptions = {},
): Promise<void> {
  const fail = (status: number, code: string) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json({ error: { code } });
  };

  if (req.method !== 'GET') return fail(405, 'method');

  const rawToken = typeof req.query.t === 'string' ? req.query.t : '';
  let token;
  try {
    token = decodeToken(rawToken);
  } catch {
    return fail(400, 'bad_token');
  }

  const name = sanitizeName(req.query.n);
  const wantInline = req.query.inline === '1' || req.query.inline === 'true';

  const ac = new AbortController();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const headerTimer = setTimeout(() => ac.abort(), timeoutMs);
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });

  try {
    const headers: Record<string, string> = {
      'User-Agent': token.m === 'crawler' ? CRAWLER_UA : UA,
      Referer: 'https://www.tiktok.com/',
    };
    if (token.c) headers.Cookie = String(token.c).slice(0, 2000);
    if (typeof req.headers.range === 'string' && RANGE_PATTERN.test(req.headers.range)) {
      headers.Range = req.headers.range;
    }

    const { res: up } = await fetchFollow(token.u, {
      headers,
      hostOk: isMediaHost,
      signal: ac.signal,
      fetcher: options.fetcher,
    });
    clearTimeout(headerTimer);

    if (!up.ok && up.status !== 206 && up.status !== 416) {
      await up.body?.cancel().catch(() => undefined);
      return fail(up.status === 403 ? 403 : 502, `upstream_${up.status}`);
    }

    const rawType =
      (up.headers.get('content-type') || 'application/octet-stream')
        .split(';')[0]
        ?.trim()
        .toLowerCase() || 'application/octet-stream';

    // Never allow active web types (e.g. text/html, image/svg+xml) to render inline.
    const isSafeType = SAFE_MEDIA_TYPES.has(rawType);
    const type = isSafeType ? rawType : 'application/octet-stream';
    let ext = EXT[type];
    if (!ext) {
      const pathExt = new URL(token.u).pathname.match(/\.([a-zA-Z0-9]{2,4})$/)?.[1]?.toLowerCase();
      ext = pathExt && Object.values(EXT).includes(pathExt) ? pathExt : 'bin';
    }
    const filename = name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
    const disposition =
      wantInline && isSafeType && type !== 'application/octet-stream' ? 'inline' : 'attachment';

    res.status(up.status);
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const h of ['content-length', 'content-range', 'accept-ranges'] as const) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!up.headers.get('accept-ranges') && disposition === 'inline') {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('X-Filename', filename);
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (!up.body || up.status === 416) {
      await up.body?.cancel().catch(() => undefined);
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(up.body as Parameters<typeof Readable.fromWeb>[0]), res);
  } catch (e) {
    clearTimeout(headerTimer);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (e instanceof HttpError) return fail(e.status, e.code);
    fail(502, 'upstream_failed');
  }
}
