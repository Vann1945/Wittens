import path from 'node:path';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import type { Config } from '../config.js';
import { log } from '../misc/log.js';
import { ApiError, errors } from '../processing/errors.js';
import { match } from '../processing/match.js';
import type { Provider } from '../processing/types.js';
import type { Fetcher } from '../stream/fetcher.js';
import { proxyTunnel, type TunnelMode } from '../stream/proxy.js';
import type { TunnelStore } from '../stream/store.js';

export interface AppDependencies {
  config: Config;
  version: string;
  provider: Provider;
  tunnels: TunnelStore;
  /** Fetcher used for third-party media. Must be SSRF-guarded in production. */
  mediaFetcher: Fetcher;
}

function sendError(res: Response, error: ApiError): void {
  res.status(error.status).json({
    status: 'error',
    error: { code: error.code, message: error.message },
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(self)',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

/**
 * Builds the Express app. Everything it needs comes in through `deps`,
 * so tests can run it against fakes and the entrypoint stays trivial.
 */
export function createApp({ config, version, provider, tunnels, mediaFetcher }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    next();
  });

  if (config.corsOrigin) {
    const origin = config.corsOrigin;
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (origin !== '*') res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Ratelimit, Ratelimit-Policy, Retry-After');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
      next();
    });
  }

  const handleRateExceeded: RequestHandler = (_req, res) => sendError(res, errors.rateExceeded());

  const resolveLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  const tunnelLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.tunnelRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    handler: handleRateExceeded,
  });

  // GET /api -> instance info (also used as the container health check)
  app.get('/api', (_req, res) => {
    res.json({
      wittens: {
        version,
        provider: provider.name,
        tunnelLifespan: config.tunnelTtlMs / 1000,
        services: ['tiktok'],
      },
    });
  });

  // POST /api/resolve -> validate link, resolve it, hand back tunnel URLs
  app.post(
    '/api/resolve',
    resolveLimiter,
    (req, _res, next) => {
      if (!req.is('application/json')) return next(errors.contentType());
      next();
    },
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      const input: unknown = req.body?.url;
      if (typeof input !== 'string') return next(errors.invalidRequest());

      try {
        const video = await match(input, {
          providers: { tiktok: provider },
          tunnels,
          timeoutMs: config.upstreamTimeoutMs,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ status: 'ok', video });
      } catch (error) {
        next(error);
      }
    },
  );

  // GET /api/stream/:token (inline, seekable) and /api/tunnel/:token (attachment)
  const tunnelRoute =
    (mode: TunnelMode): RequestHandler =>
    async (req, res, next) => {
      const entry = tunnels.get(String(req.params.token));
      if (!entry) {
        if (mode === 'inline') {
          res.status(404).end();
          return;
        }
        return next(errors.tunnelExpired());
      }
      await proxyTunnel(req, res, {
        entry,
        mode,
        fetcher: mediaFetcher,
        timeoutMs: config.upstreamTimeoutMs,
      });
    };

  app.get('/api/stream/:token', tunnelLimiter, tunnelRoute('inline'));
  app.get('/api/tunnel/:token', tunnelLimiter, tunnelRoute('attachment'));

  app.use('/api', (_req, _res, next) => next(errors.notFound()));

  // Optional: serve the built web app from the same process (what the Docker image does).
  if (config.webDistPath) {
    const webRoot = path.resolve(config.webDistPath);
    app.use(
      express.static(webRoot, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof ApiError) return sendError(res, error);

    const bodyError = error as { type?: string; status?: number };
    if (bodyError.type === 'entity.too.large') {
      return sendError(res, new ApiError('error.request.invalid', 413, 'The request body is too large.'));
    }
    if (bodyError.type === 'entity.parse.failed') return sendError(res, errors.invalidRequest());

    log.error('unhandled error', error);
    return sendError(res, new ApiError('error.internal', 500, 'Something went wrong on our side.'));
  };
  app.use(onError);

  return app;
}
