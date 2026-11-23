import type { ResolveResponse, ResolvedVideo } from '../types';

export class ResolveError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ResolveError';
    this.retryable = retryable;
  }
}

/** Asks the wittens api to resolve a TikTok link. Throws ResolveError on any failure. */
export async function resolveVideo(url: string): Promise<ResolvedVideo> {
  let response: Response;
  try {
    response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new ResolveError('Network error while fetching the video. Please try again.', true);
  }

  let body: ResolveResponse | null = null;
  try {
    body = (await response.json()) as ResolveResponse;
  } catch {
    // fall through to the generic error below
  }

  if (response.ok && body?.status === 'ok') return body.video;

  const message =
    body?.status === 'error'
      ? body.error.message
      : 'Could not fetch this video. Check that it is public.';
  throw new ResolveError(message, response.status >= 500 || response.status === 429);
}
