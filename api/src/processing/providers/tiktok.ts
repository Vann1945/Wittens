import { decodeToken, getInfo, HttpError, type RawFetcher } from '../../lib/tiktok.js';
import { ApiError, errors } from '../errors.js';
import type { Provider, ProviderAsset, ProviderResult } from '../types.js';

function unwrapDlTokenUrl(dlPath: string | null | undefined): string | null {
  if (!dlPath) return null;
  try {
    const parsed = new URL(dlPath, 'http://localhost');
    const token = parsed.searchParams.get('t');
    if (!token) return null;
    const payload = decodeToken(token);
    return payload.u;
  } catch {
    return null;
  }
}

function asset(url: string | null, sizeBytes?: number | null): ProviderAsset | null {
  return url ? { url, sizeBytes: sizeBytes ?? null } : null;
}

/**
 * Provider adapter wrapping the direct TikTok SSR downloader (`lib/tiktok.ts`)
 * for compatibility with POST /api/resolve.
 */
export function createTikTokDirectProvider(options: { fetcher?: RawFetcher } = {}): Provider {
  return {
    name: 'tiktok-direct',

    async resolve(url, signal): Promise<ProviderResult> {
      let info;
      try {
        info = await getInfo(url.toString(), { signal, fetcher: options.fetcher });
      } catch (error) {
        if (error instanceof HttpError) {
          if (error.status === 400) throw errors.invalidLink();
          if (error.status === 404) throw errors.videoNotFound(error.message);
          if (error.status === 429) throw errors.providerRateLimited();
          if (error.status === 504) throw errors.providerTimeout();
          throw new ApiError('error.provider.unreachable', 502, error.message);
        }
        throw errors.providerUnreachable();
      }

      const quals = info.video?.qualities ?? [];
      const hdQual = quals[0];
      const sdQual = quals.length > 1 ? quals[quals.length - 1] : hdQual;

      const hdUrl = unwrapDlTokenUrl(hdQual?.dl ?? info.video?.dl);
      const sdUrl = unwrapDlTokenUrl(sdQual?.dl ?? info.video?.dl);
      if (!hdUrl && !sdUrl) throw errors.noStream();

      const handle = info.author.id || 'tiktok';
      return {
        id: info.id || String(Date.now()),
        title: info.desc.trim() || 'TikTok Video',
        authorName: info.author.name || handle,
        authorHandle: handle.startsWith('@') ? handle : `@${handle}`,
        duration: info.video?.duration ?? 0,
        likeCount: info.stats.likes,
        viewCount: info.stats.plays,
        cover: asset(unwrapDlTokenUrl(info.cover?.dl)),
        hd: asset(hdUrl, hdQual?.size || null),
        sd: asset(sdUrl, sdQual?.size || null),
        audio: asset(unwrapDlTokenUrl(info.music?.dl)),
      };
    },
  };
}
