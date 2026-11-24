import type { ResolvedVideo, TikTokInfoResponse } from '../types';

export class ResolveError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ResolveError';
    this.retryable = retryable;
  }
}

interface InfoErrorBody {
  error?: { code?: string; message?: string };
}

function mapInfoToResolvedVideo(info: TikTokInfoResponse, fallbackUrl: string): ResolvedVideo {
  const quals = info.video?.qualities ?? [];
  const top = quals[0] ?? null;
  const fallbackQual = quals.length > 1 ? quals[quals.length - 1]! : top;
  const authorId = info.author?.id || 'tiktok';

  return {
    id: info.id || String(Date.now()),
    type: info.type === 'photo' && info.images.length > 0 ? 'photo' : 'video',
    sourceUrl: info.url || fallbackUrl,
    title: (info.desc || '').trim() || 'TikTok Video',
    authorName: info.author?.name || authorId,
    authorHandle: authorId.startsWith('@') ? authorId : `@${authorId}`,
    duration: info.video?.duration ?? info.music?.duration ?? 0,
    likeCount: typeof info.stats?.likes === 'number' ? info.stats.likes : null,
    viewCount: typeof info.stats?.plays === 'number' ? info.stats.plays : null,
    coverUrl: info.cover?.src ?? info.images[0]?.src ?? null,
    previewUrl: info.video?.src ?? null,
    qualities: quals,
    images: info.images ?? [],
    downloads: {
      hd: top
        ? { url: top.dl, sizeBytes: top.size > 0 ? top.size : null }
        : info.video?.dl
          ? { url: info.video.dl, sizeBytes: null }
          : null,
      sd: fallbackQual
        ? { url: fallbackQual.dl, sizeBytes: fallbackQual.size > 0 ? fallbackQual.size : null }
        : info.video?.dl
          ? { url: info.video.dl, sizeBytes: null }
          : null,
      audio: info.music?.dl ? { url: info.music.dl } : null,
    },
  };
}

/** Fetches TikTok media info via GET /api/info and wraps downloads through /api/dl. */
export async function resolveVideo(url: string): Promise<ResolvedVideo> {
  let response: Response;
  try {
    response = await fetch(`/api/info?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ResolveError('Network error while fetching the video. Please try again.', true);
  }

  let body: (TikTokInfoResponse & InfoErrorBody) | null = null;
  try {
    body = (await response.json()) as TikTokInfoResponse & InfoErrorBody;
  } catch {
    // fall through to generic error below
  }

  if (response.ok && body && !body.error && body.id) {
    return mapInfoToResolvedVideo(body, url);
  }

  const message =
    body?.error?.message || 'Could not fetch this video. Check that it is public.';
  throw new ResolveError(message, response.status >= 500 || response.status === 429);
}
