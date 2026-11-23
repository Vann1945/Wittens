import { loadConfig, loadEnvFile } from './src/config.js';
import { createApp } from './src/core/api.js';
import { getVersion } from './src/misc/version.js';
import { createTikWmProvider } from './src/processing/providers/tikwm.js';
import { createGuardedFetcher } from './src/stream/fetcher.js';
import { TunnelStore } from './src/stream/store.js';

loadEnvFile();

const config = loadConfig();
const version = getVersion();
const userAgent = `Mozilla/5.0 (compatible; Wittens/${version})`;
const mediaFetcher = createGuardedFetcher(userAgent);
const tunnels = new TunnelStore({
  ttlMs: config.tunnelTtlMs,
  maxEntries: config.tunnelMaxEntries,
});
const provider = createTikWmProvider({
  apiUrl: config.providerApiUrl,
  fetcher: (url, init) => fetch(url, init),
  userAgent,
});

// Vercel invokes the exported Express app as a serverless function.
export default createApp({ config, version, provider, tunnels, mediaFetcher });
