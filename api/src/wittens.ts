import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, loadEnvFile } from './config.js';
import { createApp } from './core/api.js';
import { log } from './misc/log.js';
import { getVersion } from './misc/version.js';
import { createTikTokDirectProvider } from './processing/providers/tiktok.js';
import { createGuardedFetcher } from './stream/fetcher.js';
import { TunnelStore } from './stream/store.js';

loadEnvFile();

let config;
try {
  config = loadConfig();
} catch (error) {
  log.error('invalid configuration', error);
  process.exit(1);
}

const version = getVersion();
const userAgent = `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html; Wittens/${version})`;

if (config.webDistPath && !existsSync(path.join(config.webDistPath, 'index.html'))) {
  log.error(`WEB_DIST_PATH has no index.html: ${config.webDistPath}. Did you run "pnpm build"?`);
  process.exit(1);
}

const mediaFetcher = createGuardedFetcher(userAgent);
const tunnels = new TunnelStore({
  ttlMs: config.tunnelTtlMs,
  maxEntries: config.tunnelMaxEntries,
});

const provider = createTikTokDirectProvider();

const app = createApp({ config, version, provider, tunnels, mediaFetcher });

const sweeper = setInterval(() => tunnels.sweep(), 60_000);
sweeper.unref();

const server = app.listen(config.port, config.host, () => {
  log.info(`wittens api ${version} listening on http://${config.host}:${config.port}`);
  log.info(`provider: ${provider.name}${config.webDistPath ? ', serving web app' : ', api only'}`);
});

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
