import { loadConfig, loadEnvFile } from '../backend/src/config.js';
import { createApp } from '../backend/src/core/api.js';
import { getVersion } from '../backend/src/misc/version.js';
import { createTikWmProvider } from '../backend/src/processing/providers/tikwm.js';
import { createGuardedFetcher } from '../backend/src/stream/fetcher.js';
import { TunnelStore } from '../backend/src/stream/store.js';

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
