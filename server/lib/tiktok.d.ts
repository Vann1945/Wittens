export declare const UA: string;

export type RawFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export declare class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string);
}

export interface WrappedAsset {
  dl: string;
  src: string;
}

export interface VideoQualityItem extends WrappedAsset {
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  size: number;
  hevc: boolean;
}

export interface PhotoSlideItem extends WrappedAsset {
  index: number;
  width: number;
  height: number;
  live: WrappedAsset | null;
}

export interface MusicInfo extends WrappedAsset {
  title: string;
  author: string;
  duration: number;
  original: boolean;
  cover: WrappedAsset | null;
}

export interface TikTokInfo {
  id: string;
  type: 'photo' | 'video';
  url: string;
  desc: string;
  created: number;
  author: {
    id: string;
    name: string;
    verified: boolean;
    avatar: WrappedAsset | null;
  };
  stats: {
    plays: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  };
  music: MusicInfo | null;
  cover: WrappedAsset | null;
  video: {
    width: number;
    height: number;
    duration: number;
    dl: string;
    src: string;
    qualities: VideoQualityItem[];
  } | null;
  images: PhotoSlideItem[];
}

export interface MediaTokenPayload {
  u: string;
  c?: string;
}

export interface FetchFollowOptions {
  headers?: Record<string, string>;
  hostOk: (hostname: string) => boolean;
  signal?: AbortSignal;
  maxHops?: number;
  fetcher?: RawFetcher;
}

export interface FetchFollowResult {
  res: Response;
  url: URL;
  cookies: Map<string, string>;
}

export interface RawVideoQuality {
  url: string;
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  size: number;
}

export type AssetWrapper = (url: string, name: string) => WrappedAsset;

export interface GetInfoOptions {
  timeoutMs?: number;
  fetcher?: RawFetcher;
}

export declare function isPageHost(host: string): boolean;
export declare function isMediaHost(host: string): boolean;
export declare function fetchFollow(
  url: string,
  options: FetchFollowOptions,
): Promise<FetchFollowResult>;
export declare function encodeToken(obj: MediaTokenPayload): string;
export declare function decodeToken(token: string | null | undefined): MediaTokenPayload;
export declare function findLive(node: unknown, depth?: number): string;
export declare function videoQualities(video: Record<string, unknown>): RawVideoQuality[];
export declare function normalize(
  item: Record<string, unknown>,
  wrap: AssetWrapper,
  pageUrl?: string,
): TikTokInfo;
export declare function getInfo(input: string, options?: GetInfoOptions): Promise<TikTokInfo>;
