import { Agent, fetch as undiciFetch } from 'undici';
import { assertSafeMediaUrl, guardedLookup } from '../security/guard.js';

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Minimal fetch signature, so providers and the proxy can be tested without a network. */
export type Fetcher = (url: string, init?: FetchInit) => Promise<Response>;

const MAX_REDIRECTS = 3;

/**
 * Fetcher for third-party media URLs. Compared to a bare fetch it:
 *  - refuses non-public destinations (see security/guard.ts),
 *  - follows redirects by hand so every hop is validated again,
 *  - applies header and idle-body timeouts.
 */
export function createGuardedFetcher(userAgent: string): Fetcher {
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup },
    headersTimeout: 15_000,
    bodyTimeout: 60_000,
  });

  return async (url, init = {}) => {
    let current = new URL(url);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      assertSafeMediaUrl(current);

      const response = await undiciFetch(current, {
        method: init.method ?? 'GET',
        body: init.body,
        signal: init.signal,
        headers: { ...init.headers, 'User-Agent': userAgent },
        redirect: 'manual',
        dispatcher,
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current);
        continue;
      }
      return response as unknown as Response;
    }

    throw new Error('too many redirects');
  };
}
