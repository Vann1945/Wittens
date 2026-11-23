import { errors } from './errors.js';
import { createFilename } from './filename.js';
import { parseLink, type Service } from './url.js';
import type { Provider, ProviderAsset, ResolvedVideo } from './types.js';
import type { TunnelStore } from '../stream/store.js';

export interface MatchContext {
  /** One provider per supported service. */
  providers: Record<Service, Provider>;
  tunnels: TunnelStore;
  timeoutMs: number;
}

/**
 * The heart of the API, mirroring cobalt's `processing/match`:
 *   raw input -> validate -> pick provider -> resolve -> register tunnels -> public response
 * Nothing in here knows about HTTP.
 */
export async function match(rawInput: string, context: MatchContext): Promise<ResolvedVideo> {
  const link = parseLink(rawInput);
  if (!link) throw errors.invalidLink();

  const provider = context.providers[link.service];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  let result;
  try {
    result = await provider.resolve(link.url, controller.signal);
  } finally {
    clearTimeout(timer);
  }

  const baseName = `${result.authorHandle.replace(/^@/, '')}_${result.id}`;

  const register = (
    source: ProviderAsset | null,
    name: string,
    extension: string,
    contentType: string,
  ): string | null =>
    source
      ? context.tunnels.create({
          url: source.url,
          filename: createFilename(name, extension),
          contentType,
        })
      : null;

  const hd = register(result.hd, `${baseName}_hd`, 'mp4', 'video/mp4');
  const sd = register(result.sd, baseName, 'mp4', 'video/mp4');
  const audio = register(result.audio, baseName, 'mp3', 'audio/mpeg');
  const cover = register(result.cover, `${baseName}_cover`, 'jpg', 'image/jpeg');

  const previewToken = hd ?? sd;

  return {
    id: result.id,
    sourceUrl: link.url.toString(),
    title: result.title,
    authorName: result.authorName,
    authorHandle: result.authorHandle,
    duration: result.duration,
    likeCount: result.likeCount,
    viewCount: result.viewCount,
    coverUrl: cover ? `/api/stream/${cover}` : null,
    previewUrl: previewToken ? `/api/stream/${previewToken}` : null,
    downloads: {
      hd: hd ? { url: `/api/tunnel/${hd}`, sizeBytes: result.hd?.sizeBytes ?? null } : null,
      sd: sd ? { url: `/api/tunnel/${sd}`, sizeBytes: result.sd?.sizeBytes ?? null } : null,
      audio: audio ? { url: `/api/tunnel/${audio}` } : null,
    },
  };
}
