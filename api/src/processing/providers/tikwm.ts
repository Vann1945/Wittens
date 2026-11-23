import { ApiError, errors } from '../errors.js';
import type { Fetcher } from '../../stream/fetcher.js';
import type { Provider, ProviderAsset, ProviderResult } from '../types.js';

interface TikWmPayload {
  code?: number;
  msg?: string;
  data?: {
    id?: string;
    title?: string;
    cover?: string;
    duration?: number;
    play?: string;
    hdplay?: string;
    music?: string;
    size?: number;
    hd_size?: number;
    digg_count?: number;
    play_count?: number;
    author?: {
      unique_id?: string;
      nickname?: string;
    };
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Accepts absolute http(s) URLs and paths relative to the provider origin. */
function toAbsoluteUrl(candidate: unknown, origin: string): string | null {
  if (typeof candidate !== 'string') return null;
  const value = candidate.trim();
  if (!value) return null;
  if (value.startsWith('https://') || value.startsWith('http://')) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return `${origin}${value}`;
  return null;
}

function asset(url: string | null, sizeBytes?: number | null): ProviderAsset | null {
  return url ? { url, sizeBytes: sizeBytes ?? null } : null;
}

/**
 * Resolver backed by the public TikWM API (https://www.tikwm.com).
 * This is a third-party service: it can change, throttle, or go away.
 * Everything TikWM specific lives in this file so it can be swapped out.
 */
export function createTikWmProvider(options: {
  apiUrl: string;
  fetcher: Fetcher;
  userAgent: string;
}): Provider {
  const { apiUrl, fetcher, userAgent } = options;
  const origin = new URL(apiUrl).origin;

  return {
    name: 'tikwm',

    async resolve(url, signal): Promise<ProviderResult> {
      let payload: TikWmPayload;
      try {
        const response = await fetcher(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': userAgent,
          },
          body: new URLSearchParams({ url: url.toString(), hd: '1' }).toString(),
          signal,
        });

        if (response.status === 429) throw errors.providerRateLimited();
        if (!response.ok) throw errors.providerUnreachable();
        payload = (await response.json()) as TikWmPayload;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw errors.providerTimeout();
        throw errors.providerUnreachable();
      }

      if (payload.code !== 0 || !payload.data) {
        if (/limit/i.test(payload.msg ?? '')) throw errors.providerRateLimited();
        throw errors.videoNotFound(payload.msg);
      }

      const data = payload.data;
      const hd = asset(toAbsoluteUrl(data.hdplay, origin), asNumber(data.hd_size));
      const sd = asset(toAbsoluteUrl(data.play, origin), asNumber(data.size));
      if (!hd && !sd) throw errors.noStream();

      const handle = data.author?.unique_id || 'tiktok';

      return {
        id: data.id || String(Date.now()),
        title: (data.title || '').trim() || 'TikTok Video',
        authorName: data.author?.nickname || handle,
        authorHandle: handle.startsWith('@') ? handle : `@${handle}`,
        duration: asNumber(data.duration) ?? 0,
        likeCount: asNumber(data.digg_count),
        viewCount: asNumber(data.play_count),
        cover: asset(toAbsoluteUrl(data.cover, origin)),
        hd,
        sd,
        audio: asset(toAbsoluteUrl(data.music, origin)),
      };
    },
  };
}
