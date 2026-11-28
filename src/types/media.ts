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

export interface MusicAsset extends WrappedAsset {
  title: string;
  author: string;
  duration: number;
  original: boolean;
  cover: WrappedAsset | null;
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
  music: MusicAsset | null;
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

export interface DownloadOption {
  url: string;
  filename?: string;
}

export interface ResolvedVideo {
  id: string;
  type: 'photo' | 'video';
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount: number | null;
  viewCount: number | null;
  coverUrl: string | null;
  coverDownloadUrl: string | null;
  previewUrl: string | null;
  sourceUrl: string;
  qualities: VideoQualityOption[];
  images: PhotoSlideItem[];
  music: MusicAsset | null;
  downloads: {
    hd: DownloadOption | null;
    sd: DownloadOption | null;
    audio: DownloadOption | null;
  };
}

export interface DownloadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}
