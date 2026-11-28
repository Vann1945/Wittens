import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';
import {
  UA,
  HttpError,
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
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
};

const VALID_RANGE_RE = /^bytes=\d*-\d*(?:,\s*\d*-\d*)*$/i;

export interface DownloadRouteOptions {
  fetcher?: RawFetcher;
}

export async function handleDownload(
  req: Request,
  res: Response,
  { fetcher }: DownloadRouteOptions = {},
): Promise<void> {
  const fail = (status: number, code: string, message?: string): void => {
    res.status(status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code, ...(message ? { message } : {}) } }));
  };

  if (req.method !== 'GET') {
    fail(405, 'method', 'Use GET.');
    return;
  }

  const rawToken = typeof req.query.t === 'string' ? req.query.t : '';
  let token: { u?: unknown; c?: unknown };
  try {
    token = decodeToken(rawToken);
  } catch {
    fail(400, 'bad_token', 'Invalid download token.');
    return;
  }

  if (typeof token.u !== 'string' || !token.u) {
    fail(400, 'bad_token', 'Invalid download token.');
    return;
  }

  const rawName = typeof req.query.n === 'string' ? req.query.n : 'tiktok';
  const name = rawName.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'tiktok';
  const inlineRequested = Boolean(req.query.inline);

  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Referer: 'https://www.tiktok.com/',
    };
    if (typeof token.c === 'string' && token.c) {
      headers.Cookie = token.c.slice(0, 2000);
    }
    if (typeof req.headers.range === 'string' && VALID_RANGE_RE.test(req.headers.range)) {
      headers.Range = req.headers.range;
    }

    const { res: up } = await fetchFollow(token.u, {
      headers,
      hostOk: isMediaHost,
      signal: ac.signal,
      fetcher,
    });

    if (!up.ok && up.status !== 206) {
      fail(up.status === 403 ? 403 : 502, `upstream_${up.status}`);
      return;
    }

    const rawContentType = (
      up.headers.get('content-type') || 'application/octet-stream'
    )
      .split(';')[0]
      ?.trim()
      .toLowerCase() || 'application/octet-stream';

    const mappedExt = EXT[rawContentType];
    const isSafeInlineMedia = Boolean(mappedExt);

    // Prevent serving active web content (e.g. text/html, image/svg+xml) inline from our origin.
    const safeContentType = isSafeInlineMedia ? rawContentType : 'application/octet-stream';
    const pathExtMatch = new URL(token.u).pathname.match(/\.([a-z0-9]{2,4})$/i);
    const ext = mappedExt || pathExtMatch?.[1]?.toLowerCase() || 'bin';
    const filename = `${name}.${ext}`;
    const disposition = inlineRequested && isSafeInlineMedia ? 'inline' : 'attachment';

    res.status(up.status);
    res.setHeader('Content-Type', safeContentType);
    for (const headerName of ['content-length', 'content-range', 'accept-ranges']) {
      const value = up.headers.get(headerName);
      if (value) res.setHeader(headerName, value);
    }
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('X-Filename', filename);
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (!up.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(up.body as unknown as NodeWebReadableStream);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.destroy();
    });
    nodeStream.pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof HttpError) {
      fail(error.status, error.code, error.message);
      return;
    }
    fail(502, 'upstream_failed', 'Failed to download media from upstream.');
  }
}
