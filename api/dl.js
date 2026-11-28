import { Readable } from 'node:stream';
import {
  UA,
  HttpError,
  decodeToken,
  fetchFollow,
  isMediaHost,
} from '../server/lib/tiktok.js';

const EXT = {
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

export default async function handler(req, res) {
  const fail = (status, code, message) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify({ error: { code, ...(message ? { message } : {}) } }));
  };

  if (req.method !== 'GET') {
    fail(405, 'method', 'Use GET.');
    return;
  }

  const query = new URL(req.url || '/', 'http://localhost').searchParams;
  let token;
  try {
    token = decodeToken(query.get('t'));
  } catch {
    fail(400, 'bad_token', 'Invalid download token.');
    return;
  }

  if (typeof token?.u !== 'string' || !token.u) {
    fail(400, 'bad_token', 'Invalid download token.');
    return;
  }

  const rawName = query.get('n') || 'tiktok';
  const name = String(rawName).replace(/[^\w.-]+/g, '_').slice(0, 100) || 'tiktok';
  const inlineRequested = Boolean(query.get('inline'));

  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const headers = {
      'User-Agent': UA,
      Referer: 'https://www.tiktok.com/',
    };
    if (typeof token.c === 'string' && token.c) {
      headers.Cookie = token.c.slice(0, 2000);
    }
    const rangeHeader = req.headers?.range;
    if (typeof rangeHeader === 'string' && VALID_RANGE_RE.test(rangeHeader)) {
      headers.Range = rangeHeader;
    }

    const { res: up } = await fetchFollow(token.u, {
      headers,
      hostOk: isMediaHost,
      signal: ac.signal,
    });

    if (!up.ok && up.status !== 206) {
      fail(up.status === 403 ? 403 : 502, `upstream_${up.status}`);
      return;
    }

    const rawContentType =
      (up.headers.get('content-type') || 'application/octet-stream')
        .split(';')[0]
        ?.trim()
        .toLowerCase() || 'application/octet-stream';

    const mappedExt = EXT[rawContentType];
    const isSafeInlineMedia = Boolean(mappedExt);

    const safeContentType = isSafeInlineMedia ? rawContentType : 'application/octet-stream';
    const pathExtMatch = new URL(token.u).pathname.match(/\.([a-z0-9]{2,4})$/i);
    const ext = mappedExt || pathExtMatch?.[1]?.toLowerCase() || 'bin';
    const filename = `${name}.${ext}`;
    const disposition = inlineRequested && isSafeInlineMedia ? 'inline' : 'attachment';

    res.statusCode = up.status;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
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

    Readable.fromWeb(up.body)
      .on('error', () => {
        if (!res.writableEnded) res.destroy();
      })
      .pipe(res);
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
