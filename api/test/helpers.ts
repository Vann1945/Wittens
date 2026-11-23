import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Config } from '../src/config.js';
import { createApp } from '../src/core/api.js';
import type { Provider, ProviderResult } from '../src/processing/types.js';
import type { Fetcher } from '../src/stream/fetcher.js';
import { TunnelStore } from '../src/stream/store.js';

export const baseConfig: Config = {
  port: 0,
  host: '127.0.0.1',
  webDistPath: null,
  corsOrigin: null,
  trustProxy: 0,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 100,
  tunnelRateLimitMax: 100,
  tunnelTtlMs: 60_000,
  tunnelMaxEntries: 50,
  upstreamTimeoutMs: 2_000,
  providerApiUrl: 'https://provider.test/api/',
};

export const sampleResult: ProviderResult = {
  id: '7300000000000000001',
  title: 'hello #world',
  authorName: 'Some Author',
  authorHandle: '@someauthor',
  duration: 12,
  likeCount: 10,
  viewCount: 200,
  cover: { url: 'https://cdn.test/cover.jpg' },
  hd: { url: 'https://cdn.test/hd.mp4', sizeBytes: 2048 },
  sd: { url: 'https://cdn.test/sd.mp4', sizeBytes: 1024 },
  audio: { url: 'https://cdn.test/audio.mp3' },
};

export function fakeProvider(result: ProviderResult | Error = sampleResult): Provider {
  return {
    name: 'fake',
    async resolve() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

export interface TestServer {
  base: string;
  tunnels: TunnelStore;
  close: () => Promise<void>;
}

export async function startTestServer(options: {
  config?: Partial<Config>;
  provider?: Provider;
  mediaFetcher?: Fetcher;
  now?: () => number;
} = {}): Promise<TestServer> {
  const config = { ...baseConfig, ...options.config };
  const tunnels = new TunnelStore({
    ttlMs: config.tunnelTtlMs,
    maxEntries: config.tunnelMaxEntries,
    now: options.now,
  });
  const app = createApp({
    config,
    version: '0.0.0-test',
    provider: options.provider ?? fakeProvider(),
    tunnels,
    mediaFetcher:
      options.mediaFetcher ??
      (async () => {
        throw new Error('unexpected media fetch');
      }),
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    tunnels,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function postResolve(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// The test suite reads JSON bodies loosely; keep assertions readable.
declare global {
  interface Response {
    json(): Promise<any>;
  }
}
