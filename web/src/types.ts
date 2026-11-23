/** Response of POST /api/resolve. Keep in sync with docs/api.md and api/src/processing/types.ts. */
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

export type ResolveResponse =
  | { status: 'ok'; video: ResolvedVideo }
  | { status: 'error'; error: { code: string; message: string } };
