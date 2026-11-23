/** A downloadable file as reported by a provider (upstream URL, not yet tunneled). */
export interface ProviderAsset {
  url: string;
  sizeBytes?: number | null;
}

/** What a provider returns for a single TikTok post. */
export interface ProviderResult {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount: number | null;
  viewCount: number | null;
  cover: ProviderAsset | null;
  hd: ProviderAsset | null;
  sd: ProviderAsset | null;
  audio: ProviderAsset | null;
}

export interface Provider {
  readonly name: string;
  /** Resolves a validated TikTok URL. Must throw ApiError for expected failures. */
  resolve(url: URL, signal: AbortSignal): Promise<ProviderResult>;
}

/** The public response of POST /api/resolve. Keep in sync with docs/api.md and web/src/types.ts. */
export interface ResolvedVideo {
  id: string;
  sourceUrl: string;
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount: number | null;
  viewCount: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
  downloads: {
    hd: { url: string; sizeBytes: number | null } | null;
    sd: { url: string; sizeBytes: number | null } | null;
    audio: { url: string } | null;
  };
}
