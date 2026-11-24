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

interface TikTokVideoObject {
  url?: string;
  name?: string;
  description?: string;
  thumbnailUrl?: string[];
  contentUrl?: string;
  duration?: string;
  creator?: {
    name?: string;
    alternateName?: string;
  };
  interactionStatistic?: Array<{
    interactionType?: { '@type'?: string } | string;
    userInteractionCount?: number | string;
  }>;
}

const DIRECT_CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function parseIsoDurationSeconds(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const total = Math.round(hours * 3600 + minutes * 60 + seconds);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

function extractCaptionFromVideoObject(vo: TikTokVideoObject): string {
  const name = (vo.name ?? '').trim();
  const desc = (vo.description ?? '').trim();
  if (desc) {
    const markerMatch = desc.match(/\(@[a-zA-Z0-9_.]+\)\.\s*[^.]+\.\s*([\s\S]+)$/);
    if (markerMatch?.[1]?.trim()) {
      return markerMatch[1].trim();
    }
  }
  return name || desc || 'TikTok Video';
}

function parseInteractionCounts(
  stats: TikTokVideoObject['interactionStatistic'],
): { likeCount: number | null; viewCount: number | null } {
  let likeCount: number | null = null;
  let viewCount: number | null = null;
  if (!Array.isArray(stats)) return { likeCount, viewCount };

  for (const item of stats) {
    const rawType =
      typeof item?.interactionType === 'string'
        ? item.interactionType
        : item?.interactionType?.['@type'] ?? '';
    const count = Number(item?.userInteractionCount);
    if (!Number.isFinite(count) || count < 0) continue;
    if (/LikeAction/i.test(rawType)) likeCount = count;
    else if (/WatchAction|ViewAction/i.test(rawType)) viewCount = count;
  }
  return { likeCount, viewCount };
}

async function resolveViaDirectTikTokPage(
  url: URL,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<ProviderResult> {
  let html: string;
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': DIRECT_CRAWLER_UA,
      },
      signal,
    });
    if (response.status === 404) throw errors.videoNotFound();
    if (response.status === 429) throw errors.providerRateLimited();
    if (!response.ok) throw errors.providerUnreachable();
    html = await response.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw errors.providerTimeout();
    throw errors.providerUnreachable();
  }

  const scriptMatch = html.match(
    /<script[^>]*id=["']VideoObject["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!scriptMatch?.[1]) {
    throw errors.videoNotFound();
  }

  let vo: TikTokVideoObject;
  try {
    vo = JSON.parse(scriptMatch[1]) as TikTokVideoObject;
  } catch {
    throw errors.providerUnreachable();
  }

  const streamUrl = toAbsoluteUrl(vo.contentUrl, 'https://www.tiktok.com');
  if (!streamUrl) throw errors.noStream();

  const coverUrl = Array.isArray(vo.thumbnailUrl)
    ? toAbsoluteUrl(vo.thumbnailUrl[0], 'https://www.tiktok.com')
    : null;

  const canonicalUrl = vo.url || url.toString();
  const idMatch =
    canonicalUrl.match(/\/video\/(\d+)/) ??
    streamUrl.match(/[?&]itemId=(\d+)/) ??
    url.pathname.match(/\/(\d+)/);
  const id = idMatch?.[1] || String(Date.now());

  const handleRaw =
    vo.creator?.alternateName?.trim() ||
    canonicalUrl.match(/\/@([a-zA-Z0-9_.]+)/)?.[1] ||
    'tiktok';
  const authorHandle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
  const authorName = vo.creator?.name?.trim() || handleRaw.replace(/^@/, '');
  const { likeCount, viewCount } = parseInteractionCounts(vo.interactionStatistic);

  return {
    id,
    title: extractCaptionFromVideoObject(vo),
    authorName,
    authorHandle,
    duration: parseIsoDurationSeconds(vo.duration),
    likeCount,
    viewCount,
    cover: asset(coverUrl),
    hd: asset(streamUrl),
    sd: asset(streamUrl),
    audio: null,
  };
}

/**
 * Resolver backed by the public TikWM API (https://www.tikwm.com) with a direct
 * TikTok VideoObject fallback when TikWM is blocked or unreachable.
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
      const isLiveTikWm = origin.includes('tikwm.com');
      let payload: TikWmPayload;
      try {
        const requestSignal = isLiveTikWm
          ? AbortSignal.any([signal, AbortSignal.timeout(3_500)])
          : signal;

        const response = await fetcher(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': userAgent,
          },
          body: new URLSearchParams({ url: url.toString(), hd: '1' }).toString(),
          signal: requestSignal,
        });

        if (response.status === 429) throw errors.providerRateLimited();
        if (!response.ok) throw errors.providerUnreachable();
        payload = (await response.json()) as TikWmPayload;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code !== 'error.provider.unreachable'
        ) {
          throw error;
        }
        // If the primary live TikWM provider times out or is unreachable (502/503/network),
        // fall back to direct TikTok VideoObject resolution using the remaining signal budget.
        if (isLiveTikWm && !signal.aborted) {
          return resolveViaDirectTikTokPage(url, fetcher, signal);
        }
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          throw errors.providerTimeout();
        }
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
