import type { Request, Response } from 'express';
import { log } from '../lib/log.ts';
import { getInfo, HttpError, type RawFetcher } from '../lib/tiktok.ts';

export interface HandleInfoOptions {
  timeoutMs: number;
  fetcher?: RawFetcher;
}

/** Express handler for GET /api/info?url=... */
export async function handleInfo(
  req: Request,
  res: Response,
  options: HandleInfoOptions,
): Promise<void> {
  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  res.setHeader('Cache-Control', 'no-store');

  try {
    const info = await getInfo(rawUrl, {
      signal: AbortSignal.timeout(options.timeoutMs),
      fetcher: options.fetcher,
    });
    res.status(200).json(info);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    log.error('[info]', error);
    res.status(500).json({
      error: { code: 'internal', message: 'Something went wrong on our side.' },
    });
  }
}
