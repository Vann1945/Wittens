import { loadConfig, loadEnvFile } from '../server/src/config.js';
import { createApp } from '../server/src/core/api.js';
import { getVersion } from '../server/src/misc/version.js';
import { createTikWmProvider } from '../server/src/processing/providers/tikwm.js';
import { createGuardedFetcher } from '../server/src/stream/fetcher.js';
import { TunnelStore } from '../server/src/stream/store.js';

loadEnvFile();
const config = loadConfig();
const version = getVersion();
const userAgent = `Mozilla/5.0 (compatible; Wittens/${version})`;
const mediaFetcher = createGuardedFetcher(userAgent);
const tunnels = new TunnelStore({ ttlMs: config.tunnelTtlMs, maxEntries: config.tunnelMaxEntries });
const provider = createTikWmProvider({
  apiUrl: config.providerApiUrl,
  fetcher: (url, init) => fetch(url, init),
  userAgent,
});

const app = createApp({ config: { ...config, webDistPath: null }, version, provider, tunnels, mediaFetcher });
export default app;
