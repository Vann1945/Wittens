import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp, errorHandler } from './server/app.ts';
import { loadConfig, loadEnvFile } from './server/config.ts';
import { log } from './server/lib/log.ts';

function readPackageVersion(): string {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    log.error('invalid configuration', error);
    process.exit(1);
  }

  const version = readPackageVersion();
  const app = createApp({ config, version });

  let closeVite: (() => Promise<void>) | undefined;

  if (!config.isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else if (config.webDistPath) {
    const webRoot = path.resolve(config.webDistPath);
    if (!existsSync(path.join(webRoot, 'index.html'))) {
      log.error(`WEB_DIST_PATH has no index.html: ${webRoot}. Run "npm run build" first.`);
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

  const server = app.listen(config.port, config.host, () => {
    const mode = config.isProd ? 'production' : 'development (vite middleware)';
    log.info(`wittens ${version} listening on http://${config.host}:${config.port} [${mode}]`);
  });

  function shutdown(signal: string): void {
    log.info(`${signal} received, shutting down`);
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
  log.error('fatal startup error', error);
  process.exit(1);
});
