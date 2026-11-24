export interface WrappedAsset {
  dl: string;
  src: string;
}

export interface VideoQualityOption extends WrappedAsset {
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

export interface TikTokInfoResponse {
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
  music: (WrappedAsset & {
    title: string;
    author: string;
    duration: number;
    original: boolean;
    cover: WrappedAsset | null;
  }) | null;
  cover: WrappedAsset | null;
  video: {
    width: number;
    height: number;
    duration: number;
    dl: string;
    src: string;
    qualities: VideoQualityOption[];
  } | null;
  images: PhotoSlideItem[];
}

export interface ResolvedVideo {
  id: string;
  type: 'photo' | 'video';
  sourceUrl: string;
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount: number | null;
  viewCount: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
  qualities: VideoQualityOption[];
  images: PhotoSlideItem[];
  downloads: {
    hd: { url: string; sizeBytes: number | null } | null;
    sd: { url: string; sizeBytes: number | null } | null;
    audio: { url: string } | null;
  };
}

export type ResolveResponse =
  | { status: 'ok'; video: ResolvedVideo }
  | { status: 'error'; error: { code: string; message: string } };
