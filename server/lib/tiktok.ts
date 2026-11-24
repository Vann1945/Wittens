import crypto from 'node:crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import { assertSafeMediaUrl, guardedLookup } from './guard.ts';
import { extractUrl } from './url.ts';

/**
 * TikTok SSR scraper & media normalizer.
 * Reads TikTok's built-in __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON (with a
 * VideoObject JSON-LD fallback when datacenter IPs hit TikTok's JS WAF) and
 * wraps every media URL in an HMAC-signed /api/dl token so CDN requests carry
 * the required Referer, User-Agent, and page session cookies.
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/* ---------- host allowlist ---------- */
const suffixOk = (host: string, suffix: string): boolean =>
  host === suffix || host.endsWith('.' + suffix);

const PAGE_HOSTS = ['tiktok.com'];
const MEDIA_HOSTS = [
  'tiktok.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'tiktokv.us',
  'tiktokv.eu',
  'byteoversea.com',
  'ibytedtos.com',
  'ibyteimg.com',
  'muscdn.com',
];

export const isPageHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return PAGE_HOSTS.some((s) => suffixOk(normalized, s));
};

export const isMediaHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return (
    MEDIA_HOSTS.some((s) => suffixOk(normalized, s)) ||
    /^v\d+[a-z-]*\.akamaized\.net$/.test(normalized)
  );
};

/* ---------- guarded HTTP client ---------- */
const guardedAgent = new Agent({
  connect: { lookup: guardedLookup },
  headersTimeout: 15_000,
  bodyTimeout: 60_000,
});

export type RawFetcher = (
  url: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    redirect?: 'manual';
    signal?: AbortSignal;
  },
) => Promise<Response>;

const defaultFetcher: RawFetcher = async (url, init = {}) => {
  const res = await undiciFetch(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    redirect: init.redirect ?? 'manual',
    signal: init.signal,
    dispatcher: guardedAgent,
  });
  return res as unknown as Response;
};

const readCookies = (res: Response): string[] => {
  const hdrs = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof hdrs.getSetCookie === 'function'
      ? hdrs.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(/,(?=\s*[\w-]+=)/);
  return list.map((c) => c.split(';')[0]?.trim() ?? '').filter(Boolean);
};

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

/** Follows redirects manually so every hop is validated against host allowlists and IP guards. */
export async function fetchFollow(
  url: string,
  { headers = {}, hostOk, signal, maxHops = 5, fetcher = defaultFetcher }: FetchFollowOptions,
): Promise<FetchFollowResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'invalid_url', 'Invalid URL.');
  }

  const jar = new Map<string, string>();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (u.protocol !== 'https:' || !hostOk(u.hostname)) {
      throw new HttpError(400, 'invalid_url', 'Host not allowed.');
    }
    try {
      assertSafeMediaUrl(u);
    } catch {
      throw new HttpError(400, 'invalid_url', 'Host not allowed.');
    }

    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const mergedHeaders: Record<string, string> = { ...headers };
    if (cookie) {
      mergedHeaders.Cookie = [headers.Cookie, cookie].filter(Boolean).join('; ');
    }

    const res = await fetcher(u, {
      redirect: 'manual',
      signal,
      headers: mergedHeaders,
    });

    for (const c of readCookies(res)) {
      const i = c.indexOf('=');
      if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
    }

    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel().catch(() => undefined);
      u = new URL(loc, u);
      continue;
    }
    return { res, url: u, cookies: jar };
  }

  throw new HttpError(502, 'too_many_redirects', 'Too many redirects.');
}

/* ---------- signed media token ---------- */
const ephemeralSecret = crypto.randomBytes(32);

function getTokenSecret(): Buffer | string {
  const configured = process.env.TOKEN_SECRET?.trim();
  return configured ? configured : ephemeralSecret;
}

export interface MediaTokenPayload {
  /** Upstream media URL. */
  u: string;
  /** Session cookies from TikTok page fetch. */
  c?: string;
  /** Optional mode ('crawler' uses CRAWLER_UA when fetching TikTok VideoObject endpoints). */
  m?: 'crawler';
}

export function encodeToken(obj: MediaTokenPayload): string {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getTokenSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function decodeToken(raw: string | null | undefined): MediaTokenPayload {
  const token = String(raw || '');
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    throw new Error('Malformed token');
  }
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac('sha256', getTokenSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }

  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as MediaTokenPayload).u !== 'string') {
    throw new Error('Invalid token payload');
  }
  return parsed as MediaTokenPayload;
}

/* ---------- normalization ---------- */
export interface WrappedAsset {
  dl: string;
  src: string;
}

export interface TikTokVideoQuality extends WrappedAsset {
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  size: number;
  hevc: boolean;
}

export interface TikTokImageItem extends WrappedAsset {
  index: number;
  width: number;
  height: number;
  live: WrappedAsset | null;
}

export interface TikTokMusic extends WrappedAsset {
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
  music: TikTokMusic | null;
  cover: WrappedAsset | null;
  video: {
    width: number;
    height: number;
    duration: number;
    dl: string;
    src: string;
    qualities: TikTokVideoQuality[];
  } | null;
  images: TikTokImageItem[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const firstUrl = (x: unknown, depth = 0): string => {
  if (!x || depth > 3) return '';
  if (typeof x === 'string') return /^https?:\/\//.test(x) ? x : '';
  if (Array.isArray(x)) return firstUrl(x[0], depth + 1);
  if (typeof x === 'object') {
    const obj = x as Record<string, unknown>;
    for (const k of ['urlList', 'UrlList', 'playAddr', 'PlayAddr', 'url', 'Url', 'src']) {
      if (obj[k]) {
        const r = firstUrl(obj[k], depth + 1);
        if (r) return r;
      }
    }
  }
  return '';
};

const preferJpeg = (list: string[] = []): string =>
  list.find((u) => /\.jpe?g(\?|$)/i.test(u)) ||
  list.find((u) => /\.png(\?|$)/i.test(u)) ||
  list[0] ||
  '';

const LIVE_SKIP = new Set([
  'imageURL',
  'displayImage',
  'ownerWatermarkImage',
  'thumbnail',
  'imageWidth',
  'imageHeight',
]);

/** Locates companion live-photo video URLs inside TikTok imagePost items. */
export function findLive(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 4) return '';
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (LIVE_SKIP.has(k)) continue;
    if (/video|live|motion|animat/i.test(k)) {
      const u = firstUrl(v);
      if (u) return u;
    }
    if (v && typeof v === 'object') {
      const r = findLive(v, depth + 1);
      if (r) return r;
    }
  }
  return '';
}

const isHevc = (c: string): boolean => /265|hevc|bytevc/i.test(c);

export interface RawVideoQuality {
  url: string;
  width: number;
  height: number;
  bitrate: number;
  codec: string;
  size: number;
}

/**
 * Sorts all bitrate variants: highest resolution first, H.264 before HEVC
 * at the same resolution (broadest player compatibility), then highest bitrate.
 */
export function videoQualities(v: Record<string, unknown>): RawVideoQuality[] {
  const out: RawVideoQuality[] = [];
  const push = (url: string, o: Omit<RawVideoQuality, 'url'>) => {
    if (url && !out.some((x) => x.url === url)) out.push({ url, ...o });
  };

  const bitrateInfo = Array.isArray(v.bitrateInfo)
    ? (v.bitrateInfo as Array<Record<string, unknown>>)
    : [];

  for (const b of bitrateInfo) {
    const pa = (b.PlayAddr || b.playAddr || {}) as Record<string, unknown>;
    push(firstUrl(pa), {
      width: num(pa.Width ?? pa.width),
      height: num(pa.Height ?? pa.height),
      bitrate: num(b.Bitrate ?? b.bitrate),
      codec: String(b.CodecType ?? b.codecType ?? ''),
      size: num(pa.DataSize ?? pa.dataSize),
    });
  }

  const playAddrObj =
    v.playAddr && typeof v.playAddr === 'object' ? (v.playAddr as Record<string, unknown>) : null;
  push(firstUrl(v.playAddr) || firstUrl(v.downloadAddr), {
    width: num(v.width),
    height: num(v.height),
    bitrate: num(v.bitrate),
    codec: '',
    size: num(playAddrObj?.DataSize),
  });

  const side = (q: RawVideoQuality) => Math.min(q.width || 0, q.height || 0);
  return out.sort(
    (a, b) =>
      side(b) - side(a) ||
      (isHevc(a.codec) ? 1 : 0) - (isHevc(b.codec) ? 1 : 0) ||
      b.bitrate - a.bitrate,
  );
}

const slug = (s: unknown): string =>
  String(s || 'x')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40);
const pad = (n: number): string => String(n).padStart(2, '0');

export type AssetWrapper = (url: string, name: string) => WrappedAsset;

/** Normalizes a TikTok SSR `itemStruct` into a clean public metadata & media shape. */
export function normalize(
  item: Record<string, unknown>,
  wrap: AssetWrapper,
  pageUrl = '',
): TikTokInfo {
  const rawAuthor = item.author;
  const a: Record<string, unknown> =
    typeof rawAuthor === 'string'
      ? { uniqueId: rawAuthor }
      : ((rawAuthor as Record<string, unknown>) || {});
  const s = (item.statsV2 || item.stats || {}) as Record<string, unknown>;
  const s0 = (item.stats || {}) as Record<string, unknown>;
  const itemId = String(item.id ?? '');
  const base = `tiktok_${slug(a.uniqueId)}_${itemId}`;
  const asset = (u: unknown, name: string): WrappedAsset | null => {
    const resolved = firstUrl(u);
    return resolved ? wrap(resolved, name) : null;
  };

  const imagePost = (item.imagePost as Record<string, unknown> | undefined) || {};
  const rawImages = Array.isArray(imagePost.images)
    ? (imagePost.images as Array<Record<string, unknown>>)
    : [];

  const images: TikTokImageItem[] = [];
  for (let i = 0; i < rawImages.length; i++) {
    const im = rawImages[i]!;
    const imageUrlObj = (im.imageURL as Record<string, unknown> | undefined) || {};
    const urlList = Array.isArray(imageUrlObj.urlList) ? (imageUrlObj.urlList as string[]) : [];
    const url = preferJpeg(urlList);
    const wrapped = url ? wrap(url, `${base}_${pad(i + 1)}`) : null;
    if (!wrapped) continue;
    const live = findLive(im);
    images.push({
      index: i,
      width: num(im.imageWidth),
      height: num(im.imageHeight),
      ...wrapped,
      live: live ? wrap(live, `${base}_${pad(i + 1)}_live`) : null,
    });
  }

  const v = (item.video as Record<string, unknown> | undefined) || {};
  const quals: TikTokVideoQuality[] = videoQualities(v).map((q) => {
    const { url, ...rest } = q;
    const heightLabel = Math.min(q.width || 0, q.height || 0) || 'hd';
    const hevc = isHevc(q.codec);
    return {
      ...rest,
      hevc,
      ...wrap(url, `${base}_${heightLabel}p${hevc ? '_hevc' : ''}`),
    };
  });

  const m = (item.music as Record<string, unknown> | undefined) || {};
  const musicPlayUrl = firstUrl(m.playUrl);
  const topQuality = quals[0];

  return {
    id: itemId,
    type: images.length ? 'photo' : 'video',
    url: pageUrl,
    desc: String(item.desc || ''),
    created: num(item.createTime),
    author: {
      id: String(a.uniqueId || ''),
      name: String(a.nickname || a.uniqueId || ''),
      verified: Boolean(a.verified),
      avatar: asset(a.avatarLarger || a.avatarMedium || a.avatarThumb, `${base}_avatar`),
    },
    stats: {
      plays: num(s.playCount ?? s0.playCount),
      likes: num(s.diggCount ?? s0.diggCount),
      comments: num(s.commentCount ?? s0.commentCount),
      shares: num(s.shareCount ?? s0.shareCount),
      saves: num(s.collectCount ?? s0.collectCount),
    },
    music: musicPlayUrl
      ? {
          title: String(m.title || 'Original sound'),
          author: String(m.authorName || ''),
          duration: num(m.duration),
          original: Boolean(m.original),
          cover: asset(m.coverLarge || m.coverMedium || m.coverThumb, `${base}_music_cover`),
          ...wrap(musicPlayUrl, `${base}_music`),
        }
      : null,
    cover: asset(v.originCover || v.cover || v.dynamicCover, `${base}_cover`),
    video:
      !images.length && topQuality
        ? {
            width: topQuality.width,
            height: topQuality.height,
            duration: num(v.duration),
            dl: topQuality.dl,
            src: topQuality.src,
            qualities: quals,
          }
        : null,
    images,
  };
}

/* ---------- fallback VideoObject parser (for datacenter WAF blocks) ---------- */
interface TikTokVideoObject {
  url?: string;
  name?: string;
  description?: string;
  thumbnailUrl?: string[];
  contentUrl?: string;
  duration?: string;
  width?: number;
  height?: number;
  uploadDate?: string;
  creator?: {
    name?: string;
    alternateName?: string;
    image?: string;
    disambiguatingDescription?: string;
  };
  interactionStatistic?: Array<{
    interactionType?: { '@type'?: string } | string;
    userInteractionCount?: number | string;
  }>;
  commentCount?: number | string;
}

function parseIsoDurationSeconds(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return 0;
  const total = Math.round(
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0),
  );
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

function extractCaptionFromVideoObject(vo: TikTokVideoObject): string {
  const name = (vo.name ?? '').trim();
  const desc = (vo.description ?? '').trim();
  if (desc) {
    const markerMatch = desc.match(/\(@[a-zA-Z0-9_.]+\)\.\s*[^.]+\.\s*([\s\S]+)$/);
    if (markerMatch?.[1]?.trim()) return markerMatch[1].trim();
  }
  return name || desc || '';
}

async function fallbackVideoObjectInfo(
  u: URL,
  signal: AbortSignal,
  fetcher: RawFetcher,
): Promise<TikTokInfo | null> {
  const page = await fetchFollow(u.href, {
    hostOk: isPageHost,
    signal,
    fetcher,
    headers: {
      'User-Agent': CRAWLER_UA,
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (page.res.status === 404) {
    throw new HttpError(404, 'not_found', 'Video not found, private, or removed.');
  }
  if (!page.res.ok) return null;

  const html = await page.res.text();
  const scriptMatch = html.match(/<script[^>]*id=["']VideoObject["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch?.[1]) return null;

  let vo: TikTokVideoObject;
  try {
    vo = JSON.parse(scriptMatch[1]) as TikTokVideoObject;
  } catch {
    return null;
  }

  const streamUrl = firstUrl(vo.contentUrl);
  if (!streamUrl) return null;

  const canonicalUrl = vo.url || page.url.origin + page.url.pathname;
  const idMatch =
    canonicalUrl.match(/\/video\/(\d+)/) ??
    streamUrl.match(/[?&]itemId=(\d+)/) ??
    page.url.pathname.match(/\/(\d+)/);
  const id = idMatch?.[1] || String(Date.now());

  const authorId =
    vo.creator?.alternateName?.trim() ||
    canonicalUrl.match(/\/@([a-zA-Z0-9_.]+)/)?.[1] ||
    'tiktok';
  const authorName = vo.creator?.name?.trim() || authorId;
  const base = `tiktok_${slug(authorId)}_${id}`;

  const wrapCrawler: AssetWrapper = (mediaUrl, name) => {
    const dl = `/api/dl?t=${encodeToken({ u: mediaUrl, m: 'crawler' })}&n=${encodeURIComponent(name)}`;
    return { dl, src: `${dl}&inline=1` };
  };

  let plays = 0;
  let likes = 0;
  let shares = 0;
  for (const stat of vo.interactionStatistic ?? []) {
    const rawType =
      typeof stat?.interactionType === 'string'
        ? stat.interactionType
        : stat?.interactionType?.['@type'] ?? '';
    const count = num(stat?.userInteractionCount);
    if (/WatchAction|ViewAction/i.test(rawType)) plays = count;
    else if (/LikeAction/i.test(rawType)) likes = count;
    else if (/ShareAction/i.test(rawType)) shares = count;
  }

  const width = num(vo.width) || 576;
  const height = num(vo.height) || 1024;
  const duration = parseIsoDurationSeconds(vo.duration);
  const heightLabel = Math.min(width, height) || 'hd';
  const videoAsset = wrapCrawler(streamUrl, `${base}_${heightLabel}p`);
  const coverUrl = Array.isArray(vo.thumbnailUrl) ? firstUrl(vo.thumbnailUrl[0]) : '';
  const avatarUrl = firstUrl(vo.creator?.image);

  return {
    id,
    type: 'video',
    url: canonicalUrl,
    desc: extractCaptionFromVideoObject(vo),
    created: vo.uploadDate ? Math.floor(Date.parse(vo.uploadDate) / 1000) || 0 : 0,
    author: {
      id: authorId,
      name: authorName,
      verified: vo.creator?.disambiguatingDescription === 'verified',
      avatar: avatarUrl ? wrapCrawler(avatarUrl, `${base}_avatar`) : null,
    },
    stats: {
      plays,
      likes,
      comments: num(vo.commentCount),
      shares,
      saves: 0,
    },
    music: null,
    cover: coverUrl ? wrapCrawler(coverUrl, `${base}_cover`) : null,
    video: {
      width,
      height,
      duration,
      dl: videoAsset.dl,
      src: videoAsset.src,
      qualities: [
        {
          width,
          height,
          bitrate: 0,
          codec: 'h264',
          size: 0,
          hevc: false,
          ...videoAsset,
        },
      ],
    },
    images: [],
  };
}

/* ---------- main entry point ---------- */
export interface GetInfoOptions {
  signal?: AbortSignal;
  fetcher?: RawFetcher;
  disableFallback?: boolean;
}

export async function getInfo(
  input: string,
  options: GetInfoOptions = {},
): Promise<TikTokInfo> {
  const raw = String(input || '').trim();
  const candidate = extractUrl(raw) ?? raw;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    throw new HttpError(
      400,
      'invalid_url',
      'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
    );
  }
  if (!/^https?:$/.test(u.protocol) || !isPageHost(u.hostname)) {
    throw new HttpError(
      400,
      'invalid_url',
      'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
    );
  }
  if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) {
    throw new HttpError(
      400,
      'invalid_url',
      'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
    );
  }
  u.protocol = 'https:';
  u.port = '';
  u.hash = '';

  const fetcher = options.fetcher ?? defaultFetcher;
  const signal = options.signal ?? AbortSignal.timeout(15_000);

  let page: FetchFollowResult;
  try {
    page = await fetchFollow(u.href, {
      hostOk: isPageHost,
      signal,
      fetcher,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'upstream_timeout', 'TikTok did not respond in time. Please try again.');
  }

  const html = await page.res.text();
  const m = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );

  if (!m?.[1]) {
    if (!options.disableFallback && !signal.aborted) {
      try {
        const fallback = await fallbackVideoObjectInfo(page.url, signal, fetcher);
        if (fallback) return fallback;
      } catch (fallbackErr) {
        if (fallbackErr instanceof HttpError && fallbackErr.status === 404) {
          throw fallbackErr;
        }
      }
    }
    throw new HttpError(
      502,
      'blocked',
      'TikTok blocked this request (captcha or datacenter IP) or the page structure changed.',
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    throw new HttpError(502, 'parse_failed', 'Could not read TikTok page data.');
  }

  const scope = (data.__DEFAULT_SCOPE__ as Record<string, unknown> | undefined) || {};
  const detail = (scope['webapp.video-detail'] as Record<string, unknown> | undefined) || {};
  const itemInfo = (detail.itemInfo as Record<string, unknown> | undefined) || {};
  const item = itemInfo.itemStruct as Record<string, unknown> | undefined;

  if (!item) {
    const statusCode = Number(detail.statusCode ?? 0);
    const gone = Number.isFinite(statusCode) && statusCode !== 0;
    throw new HttpError(
      gone ? 404 : 502,
      gone ? 'not_found' : 'parse_failed',
      gone
        ? 'Video not found, private, or removed.'
        : 'Video data could not be found on the page.',
    );
  }

  let cookie = [...page.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie.length > 1800) {
    cookie = cookie.slice(0, 1800).replace(/;[^;]*$/, '');
  }

  const wrap: AssetWrapper = (mediaUrl, name) => {
    const dl = `/api/dl?t=${encodeToken({ u: mediaUrl, c: cookie })}&n=${encodeURIComponent(name)}`;
    return { dl, src: `${dl}&inline=1` };
  };

  return normalize(item, wrap, page.url.origin + page.url.pathname);
}
