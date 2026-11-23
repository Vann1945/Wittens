import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response as ExpressResponse } from 'express';
import { errors } from '../processing/errors.js';
import type { Fetcher } from './fetcher.js';
import type { TunnelEntry } from './store.js';

export type TunnelMode = 'inline' | 'attachment';

interface ProxyOptions {
  entry: TunnelEntry;
  mode: TunnelMode;
  fetcher: Fetcher;
  timeoutMs: number;
}

function sendFailure(res: ExpressResponse, mode: TunnelMode): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (mode === 'attachment') {
    const error = errors.tunnelFailed();
    res.status(error.status).json({
      status: 'error',
      error: { code: error.code, message: error.message },
    });
  } else {
    res.status(502).end();
  }
}

/**
 * Streams an upstream file to the client without storing it.
 *  - `inline` supports Range requests so <video> can seek.
 *  - `attachment` forces a download with a clean file name.
 * The Content-Type is always the one we decided on when the link was resolved,
 * never the upstream one, so a hostile upstream can't make us serve HTML.
 */
export async function proxyTunnel(
  req: Request,
  res: ExpressResponse,
  { entry, mode, fetcher, timeoutMs }: ProxyOptions,
): Promise<void> {
  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), timeoutMs);

  // Stop pulling from upstream as soon as the client goes away.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  let upstream: Response;
  try {
    const headers: Record<string, string> = {};
    if (mode === 'inline' && typeof req.headers.range === 'string') {
      headers.Range = req.headers.range;
    }
    upstream = await fetcher(entry.url, { headers, signal: controller.signal });
  } catch {
    clearTimeout(headerTimer);
    sendFailure(res, mode);
    return;
  }
  clearTimeout(headerTimer);

  const status = upstream.status;
  const acceptable = status === 200 || (mode === 'inline' && (status === 206 || status === 416));
  if (!acceptable) {
    await upstream.body?.cancel().catch(() => undefined);
    sendFailure(res, mode);
    return;
  }

  res.status(status);
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  if (mode === 'inline') {
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Cache-Control', 'private, max-age=300');
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  if (!upstream.body || status === 416) {
    await upstream.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res);
  } catch {
    // Client disconnected or upstream broke mid-stream: nothing more to send.
    res.destroy();
  }
}
