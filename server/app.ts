import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from './config.ts';
import { log } from './lib/log.ts';
import type { RawFetcher } from './lib/tiktok.ts';
import { handleDownload } from './routes/download.ts';
import { handleInfo } from './routes/info.ts';

export interface AppDependencies {
  config: Config;
  version: string;
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
  log.error('unhandled error', error);
  res.status(500).json({
    error: { code: 'internal', message: 'Something went wrong on our side.' },
  });
};

/**
 * Builds the Express API app. Everything it needs comes through `deps`
 * so tests can inject fake fetchers without touching the network.
 */
export function createApp({ config, version, tiktokFetcher }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const securityHeaders = buildSecurityHeaders(config.isProd);
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      res.setHeader(name, value);
    }
    next();
  });

  if (config.corsOrigin) {
    const origin = config.corsOrigin;
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (origin !== '*') res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Ratelimit, Ratelimit-Policy, Retry-After');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
      next();
    });
  }

  const handleRateExceeded: RequestHandler = (_req, res) => {
    res.status(429).json({
      error: {
        code: 'rate_exceeded',
        message: 'You are making too many requests. Please slow down a little.',
      },
    });
  };

  const infoLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.infoRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  const downloadLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.downloadRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  // GET /api -> health check and instance info
  app.get('/api', (_req, res) => {
    res.json({
      wittens: {
        version,
        provider: 'tiktok',
        services: ['tiktok'],
      },
    });
  });

  // GET /api/info?url=... -> TikTok metadata & signed /api/dl media URLs
  app.get('/api/info', infoLimiter, async (req: Request, res: Response) => {
    await handleInfo(req, res, {
      timeoutMs: config.upstreamTimeoutMs,
      fetcher: tiktokFetcher,
    });
  });

  // GET /api/dl?t=<token>&n=<name>[&inline=1] -> streams TikTok CDN media
  app.get('/api/dl', downloadLimiter, async (req: Request, res: Response) => {
    await handleDownload(req, res, {
      fetcher: tiktokFetcher,
      timeoutMs: config.upstreamTimeoutMs,
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: 'Endpoint not found.' },
    });
  });

  return app;
}
