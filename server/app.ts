import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import type { RawFetcher } from './lib/tiktok.js';
import { handleDownload } from './routes/dl.ts';
import { handleInfo } from './routes/info.ts';

export interface AppOptions {
  isProd?: boolean;
  version?: string;
  upstreamTimeoutMs?: number;
  infoRateLimitMax?: number;
  downloadRateLimitMax?: number;
  rateLimitWindowMs?: number;
  /** Optional custom fetcher for /api/info and /api/dl (used in tests). */
  tiktokFetcher?: RawFetcher;
}

function buildSecurityHeaders(isProd: boolean): Record<string, string> {
  const scriptSrc = isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  const connectSrc = isProd ? "connect-src 'self'" : "connect-src 'self' ws: wss:";
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(self)',
    'Content-Security-Policy': [
      "default-src 'self'",
      scriptSrc,
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      connectSrc,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
  };
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[server]', error);
  res.status(500).json({
    error: { code: 'internal', message: 'Something went wrong on the server.' },
  });
};

/**
 * Builds the Express API app with zero .env configuration required.
 */
export function createApp({
  isProd = false,
  version = '1.0.0',
  upstreamTimeoutMs = 15_000,
  infoRateLimitMax = 30,
  downloadRateLimitMax = 120,
  rateLimitWindowMs = 60_000,
  tiktokFetcher,
}: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const securityHeaders = buildSecurityHeaders(isProd);
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      res.setHeader(name, value);
    }
    next();
  });

  const handleRateExceeded: RequestHandler = (_req, res) => {
    res.status(429).json({
      error: {
        code: 'rate_exceeded',
        message: 'Too many requests. Please wait a moment and try again.',
      },
    });
  };

  const infoLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: infoRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  const downloadLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: downloadRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  // GET /api -> health check
  app.get('/api', (_req, res) => {
    res.json({
      ok: true,
      version,
      scraper: 'tiktok',
    });
  });

  // GET /api/info?url=... -> scrape TikTok post metadata and tokenized media links
  app.get('/api/info', infoLimiter, (req: Request, res: Response, next: NextFunction) => {
    void handleInfo(req, res, {
      timeoutMs: upstreamTimeoutMs,
      fetcher: tiktokFetcher,
    }).catch(next);
  });

  // GET /api/dl?t=<token>&n=<name>[&inline=1] -> proxy media stream from TikTok CDN
  app.get('/api/dl', downloadLimiter, (req: Request, res: Response, next: NextFunction) => {
    void handleDownload(req, res, {
      fetcher: tiktokFetcher,
    }).catch(next);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: 'Endpoint not found.' },
    });
  });

  return app;
}
