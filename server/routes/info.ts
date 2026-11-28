import type { Request, Response } from 'express';
import { getInfo, HttpError, type RawFetcher } from '../lib/tiktok.ts';

export interface InfoRouteOptions {
  timeoutMs?: number;
  fetcher?: RawFetcher;
}

export async function handleInfo(
  req: Request,
  res: Response,
  options: InfoRouteOptions = {},
): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.status(status);
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  };

  if (req.method !== 'GET') {
    send(405, { error: { code: 'method', message: 'Use GET.' } });
    return;
  }

  const urlParam = typeof req.query.url === 'string' ? req.query.url : '';
  try {
    const info = await getInfo(urlParam, options);
    send(200, info);
  } catch (error) {
    if (error instanceof HttpError) {
      send(error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    console.error('[info]', error);
    send(500, { error: { code: 'internal', message: 'Server error while fetching post.' } });
  }
}
