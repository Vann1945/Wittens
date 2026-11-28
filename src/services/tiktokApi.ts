import type {
  DownloadProgress,
  ResolvedVideo,
  TikTokInfoResponse,
} from '../types/media';

export class ResolveError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ResolveError';
    this.code = code;
    this.retryable = retryable;
  }
}

interface ApiErrorBody {
  error?: string | { code?: unknown; message?: unknown };
  message?: unknown;
}

function extractApiError(payload: unknown): { code: string; message: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as ApiErrorBody;

  if (typeof body.error === 'string' && body.error.trim()) {
    return { code: 'request_failed', message: body.error.trim() };
  }
  if (body.error && typeof body.error === 'object') {
    const code =
      typeof body.error.code === 'string' && body.error.code.trim()
        ? body.error.code.trim()
        : 'request_failed';
    const message =
      typeof body.error.message === 'string' && body.error.message.trim()
        ? body.error.message.trim()
        : '';
    if (message) return { code, message };
    return { code, message: 'Could not load this TikTok post.' };
  }
  if (typeof body.message === 'string' && body.message.trim()) {
    return { code: 'request_failed', message: body.message.trim() };
  }
  return null;
}

function isSafeProxyPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/api/dl?');
}

function isTikTokInfoResponse(payload: unknown): payload is TikTokInfoResponse {
  if (!payload || typeof payload !== 'object') return false;
  const rec = payload as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    (rec.type === 'video' || rec.type === 'photo') &&
    (rec.video !== null || (Array.isArray(rec.images) && rec.images.length > 0))
  );
}

function mapInfoToResolvedVideo(info: TikTokInfoResponse, fallbackSourceUrl: string): ResolvedVideo {
  const qualities = (info.video?.qualities ?? []).filter(
    (q) => isSafeProxyPath(q.dl) && isSafeProxyPath(q.src),
  );
  const images = (info.images ?? []).filter(
    (img) => isSafeProxyPath(img.dl) && isSafeProxyPath(img.src),
  );

  const primaryQuality = qualities[0] ?? null;
  const secondaryQuality = qualities[1] ?? null;

  const coverUrl =
    (info.cover && isSafeProxyPath(info.cover.src) ? info.cover.src : null) ??
    images[0]?.src ??
    null;

  const coverDownloadUrl =
    (info.cover && isSafeProxyPath(info.cover.dl) ? info.cover.dl : null) ??
    images[0]?.dl ??
    null;

  const previewUrl =
    info.type === 'photo'
      ? (images[0]?.src ?? null)
      : (primaryQuality?.src ??
          (info.video && isSafeProxyPath(info.video.src) ? info.video.src : null));

  const hdDownload =
    primaryQuality
      ? { url: primaryQuality.dl }
      : info.video && isSafeProxyPath(info.video.dl)
        ? { url: info.video.dl }
        : null;

  const sdDownload = secondaryQuality ? { url: secondaryQuality.dl } : null;

  const audioDownload =
    info.music && isSafeProxyPath(info.music.dl)
      ? { url: info.music.dl }
      : null;

  return {
    id: info.id || String(Date.now()),
    type: info.type === 'photo' && images.length > 0 ? 'photo' : 'video',
    title: info.desc || '',
    authorName: info.author?.name || info.author?.id || 'TikTok Creator',
    authorHandle: info.author?.id || '',
    duration: info.video?.duration || info.music?.duration || 0,
    likeCount: typeof info.stats?.likes === 'number' ? info.stats.likes : null,
    viewCount: typeof info.stats?.plays === 'number' ? info.stats.plays : null,
    coverUrl,
    coverDownloadUrl,
    previewUrl,
    sourceUrl: info.url || fallbackSourceUrl,
    qualities,
    images,
    music: info.music && isSafeProxyPath(info.music.dl) ? info.music : null,
    downloads: {
      hd: hdDownload,
      sd: sdDownload,
      audio: audioDownload,
    },
  };
}

function tryParseJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function resolveVideo(url: string): Promise<ResolvedVideo> {
  const endpoint = `/api/info?url=${encodeURIComponent(url.trim())}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch {
      if (attempt === 0) {
        await new Promise((r) => window.setTimeout(r, 500));
        continue;
      }
      throw new ResolveError(
        'network_error',
        'Could not reach the server. Check your connection and try again.',
        true,
      );
    }

    const rawText = await response.text().catch(() => '');
    const payload = tryParseJson(rawText);

    if (!response.ok) {
      const extracted = extractApiError(payload);
      const retryable = response.status >= 500 || response.status === 429;
      throw new ResolveError(
        extracted?.code ?? `http_${response.status}`,
        extracted?.message ??
          (response.status >= 500
            ? 'The scraper could not reach TikTok right now. Please try again.'
            : 'Could not fetch this TikTok post. Make sure the link is public.'),
        retryable,
      );
    }

    if (isTikTokInfoResponse(payload)) {
      return mapInfoToResolvedVideo(payload, url.trim());
    }

    // If a proxy or dev server briefly returned HTML/non-JSON during restart, retry once cleanly.
    if (attempt === 0) {
      await new Promise((r) => window.setTimeout(r, 600));
      continue;
    }

    throw new ResolveError(
      'invalid_response',
      'The server returned an invalid response. Refresh the page and try again.',
      true,
    );
  }

  throw new ResolveError(
    'invalid_response',
    'The server returned an invalid response. Refresh the page and try again.',
    true,
  );
}

/**
 * Streams a media file from /api/dl, reports real-time progress via onProgress,
 * reads the suggested X-Filename header, and triggers a browser file save.
 */
export async function downloadMediaWithProgress(
  url: string,
  fallbackFilename: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!isSafeProxyPath(url)) {
    throw new Error('Invalid media download link.');
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = 'Download failed. Try refreshing the link.';
    try {
      const rawErr = await response.text();
      const extracted = extractApiError(tryParseJson(rawErr));
      if (extracted?.message) message = extracted.message;
    } catch {
      // Non-JSON error body
    }
    throw new Error(message);
  }

  const headerFilename = response.headers.get('x-filename')?.trim();
  const filename = headerFilename || fallbackFilename;
  const contentLengthHeader = response.headers.get('content-length');
  const parsedTotal = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;
  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  onProgress({ loaded: 0, total, percent: total ? 0 : null });

  let blob: Blob;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(new Uint8Array(value));
          loaded += value.byteLength;
          const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
          onProgress({ loaded, total, percent });
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }

    onProgress({ loaded, total: total ?? loaded, percent: 100 });
    blob = new Blob(chunks, { type: contentType });
  } else {
    blob = await response.blob();
    onProgress({ loaded: blob.size, total: blob.size, percent: 100 });
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);

  return filename;
}
