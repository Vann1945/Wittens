export interface ResolvedVideo {
  id: string;
  sourceUrl?: string;
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount?: number | null;
  viewCount?: number | null;
  coverUrl: string | null;
  previewUrl?: string | null;
  downloads: {
    hd: { url: string; sizeBytes: number | null } | null;
    sd: { url: string; sizeBytes: number | null } | null;
    audio: { url: string } | null;
  };
}
