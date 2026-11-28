import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp, errorHandler } from './server/app.ts';

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function detectProductionMode(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'development') return false;
  const runningUnderTsx =
    process.execArgv.some((arg) => arg.includes('tsx')) ||
    process.argv.some((arg) => arg.includes('tsx'));
  const hasBuiltDist = existsSync(path.resolve('dist', 'index.html'));
  return !runningUnderTsx && hasBuiltDist;
}

async function main(): Promise<void> {
  const isProd = detectProductionMode();
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';
  const version = readPackageVersion();

  const app = createApp({ isProd, version });

  let closeVite: (() => Promise<void>) | undefined;

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else {
    const webRoot = path.resolve('dist');
    if (!existsSync(path.join(webRoot, 'index.html'))) {
      console.error(`Missing production build at ${webRoot}. Run "npm run build" first.`);
      process.exit(1);
    }

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

  app.use(errorHandler);

  const server = app.listen(port, host, () => {
    const mode = isProd ? 'production' : 'development (vite middleware)';
    console.log(`[server] listening on http://${host}:${port} [${mode}]`);
  });

  function shutdown(signal: string): void {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closeVite?.().catch(() => undefined);
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[server] fatal startup error', error);
  process.exit(1);
});
