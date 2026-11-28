import type { IncomingMessage, ServerResponse } from 'node:http';
import { getInfo, HttpError } from '../server/lib/tiktok.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET') {
    send(405, { error: { code: 'method', message: 'Use GET.' } });
    return;
  }

  const targetUrl = new URL(req.url || '/', 'http://localhost').searchParams.get('url') || '';
  try {
    const info = await getInfo(targetUrl);
    send(200, info);
  } catch (error) {
    if (error instanceof HttpError) {
      send(error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    console.error('[api/info]', error);
    send(500, { error: { code: 'internal', message: 'Server error while fetching post.' } });
  }
}
