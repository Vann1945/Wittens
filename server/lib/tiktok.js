/* TikTok scraper:
   1) Primary: scrapes embedded SSR JSON (__UNIVERSAL_DATA_FOR_REHYDRATION__) directly from TikTok.
   2) Fallback: if TikTok serves a datacenter WAF/captcha challenge (e.g. SlardarWAF),
      falls back automatically to tikwm's public endpoint (no API key or .env required).
   All media URLs are wrapped in tokenized /api/dl proxy links so requests carry the
   required Referer, User-Agent, Range headers, and session cookies. */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/* ---------- Host allowlists (prevent SSRF) ---------- */
const suffixOk = (host, suffix) => {
  const normalized = String(host || '').toLowerCase();
  return normalized === suffix || normalized.endsWith(`.${suffix}`);
};

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
  'tikwm.com',
];

export const isPageHost = (host) => PAGE_HOSTS.some((suffix) => suffixOk(host, suffix));

export const isMediaHost = (host) =>
  MEDIA_HOSTS.some((suffix) => suffixOk(host, suffix)) ||
  /^v\d+[a-z-]*\.akamaized\.net$/i.test(String(host || ''));

function readCookies(res) {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') || '').split(/,(?=\s*[\w-]+=)/);
  return list.map((cookie) => (cookie.split(';')[0] || '').trim()).filter(Boolean);
}

/* Follow redirects manually so every hop is checked against the host allowlist. */
export async function fetchFollow(
  url,
  { headers = {}, hostOk, signal, maxHops = 5, fetcher = fetch } = {},
) {
  let currentUrl;
  try {
    currentUrl = new URL(url);
  } catch {
    throw new HttpError(400, 'invalid_url', 'Invalid URL.');
  }

  const jar = new Map();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (currentUrl.protocol !== 'https:' || !hostOk(currentUrl.hostname)) {
      throw new HttpError(400, 'invalid_url', 'Host is not allowed.');
    }

    const jarCookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const mergedCookie = [headers.Cookie, jarCookie].filter(Boolean).join('; ');
    const requestHeaders = {
      ...headers,
      ...(mergedCookie ? { Cookie: mergedCookie } : {}),
    };

    const res = await fetcher(currentUrl, {
      redirect: 'manual',
      signal,
      headers: requestHeaders,
    });

    for (const cookie of readCookies(res)) {
      const idx = cookie.indexOf('=');
      if (idx > 0) {
        jar.set(cookie.slice(0, idx), cookie.slice(idx + 1));
      }
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    return { res, url: currentUrl, cookies: jar };
  }

  throw new HttpError(502, 'too_many_redirects', 'Too many redirects.');
}

/* ---------- Media token codec ---------- */
export function encodeToken(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function decodeToken(token) {
  const raw = String(token ?? '');
  if (!raw || raw.length > 8192) {
    throw new Error('Invalid token');
  }
  const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid token payload');
  }
  return parsed;
}

/* ---------- Normalization helpers ---------- */
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstUrl = (value, depth = 0) => {
  if (!value || depth > 3) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
  if (Array.isArray(value)) return firstUrl(value[0], depth + 1);
  if (typeof value === 'object') {
    for (const key of ['urlList', 'UrlList', 'playAddr', 'PlayAddr', 'url', 'Url', 'src']) {
      if (value[key]) {
        const result = firstUrl(value[key], depth + 1);
        if (result) return result;
      }
    }
  }
  return '';
};

const preferJpeg = (list = []) => {
  const urls = Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
  return (
    urls.find((u) => /\.jpe?g(\?|$)/i.test(u)) ||
    urls.find((u) => /\.png(\?|$)/i.test(u)) ||
    urls[0] ||
    ''
  );
};

/* Search for companion video inside photo items (live photo). */
const LIVE_SKIP = new Set([
  'imageURL',
  'displayImage',
  'ownerWatermarkImage',
  'thumbnail',
  'imageWidth',
  'imageHeight',
]);

export function findLive(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return '';
  for (const [key, value] of Object.entries(node)) {
    if (LIVE_SKIP.has(key)) continue;
    if (/video|live|motion|animat/i.test(key)) {
      const found = firstUrl(value);
      if (found) return found;
    }
    if (value && typeof value === 'object') {
      const nested = findLive(value, depth + 1);
      if (nested) return nested;
    }
  }
  return '';
}

const isHevc = (codec) => /265|hevc|bytevc/i.test(String(codec || ''));

/* Order video variants: highest resolution first, H.264 before HEVC at equal
   resolution for maximum browser compatibility, then highest bitrate. */
export function videoQualities(video = {}) {
  const out = [];
  const push = (url, meta) => {
    if (url && !out.some((item) => item.url === url)) {
      out.push({ url, ...meta });
    }
  };

  const bitrateInfo = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : [];

  for (const entry of bitrateInfo) {
    const playAddr = entry.PlayAddr ?? entry.playAddr ?? {};
    push(firstUrl(playAddr), {
      width: num(playAddr.Width ?? playAddr.width),
      height: num(playAddr.Height ?? playAddr.height),
      bitrate: num(entry.Bitrate ?? entry.bitrate),
      codec: String(entry.CodecType ?? entry.codecType ?? ''),
      size: num(playAddr.DataSize ?? playAddr.dataSize),
    });
  }

  const playAddrObj =
    video.playAddr && typeof video.playAddr === 'object' ? video.playAddr : null;

  push(firstUrl(video.playAddr) || firstUrl(video.downloadAddr), {
    width: num(video.width),
    height: num(video.height),
    bitrate: num(video.bitrate),
    codec: '',
    size: num(playAddrObj?.DataSize),
  });

  const side = (q) => Math.min(q.width || 0, q.height || 0);
  return out.sort(
    (a, b) =>
      side(b) - side(a) ||
      (isHevc(a.codec) ? 1 : 0) - (isHevc(b.codec) ? 1 : 0) ||
      b.bitrate - a.bitrate,
  );
}

const slug = (value) =>
  String(value || 'x')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40);

const pad = (value) => String(value).padStart(2, '0');

/* Normalize a TikTok SSR itemStruct using `wrap(url, name)`. */
export function normalize(item, wrap, pageUrl = '') {
  const author =
    typeof item.author === 'string' ? { uniqueId: item.author } : item.author || {};
  const statsPrimary = item.statsV2 || item.stats || {};
  const statsFallback = item.stats || {};
  const itemId = String(item.id ?? '');
  const base = `tiktok_${slug(author.uniqueId)}_${itemId}`;
  const asset = (url, name) => (typeof url === 'string' && url ? wrap(url, name) : null);

  const rawImages = Array.isArray(item.imagePost?.images) ? item.imagePost.images : [];
  const images = [];
  rawImages.forEach((im, index) => {
    const url = preferJpeg(im.imageURL?.urlList);
    const wrapped = asset(url, `${base}_${pad(index + 1)}`);
    if (!wrapped) return;
    const liveUrl = findLive(im);
    images.push({
      index,
      width: num(im.imageWidth),
      height: num(im.imageHeight),
      ...wrapped,
      live: liveUrl ? asset(liveUrl, `${base}_${pad(index + 1)}_live`) : null,
    });
  });

  const videoObj = item.video || {};
  const qualities = videoQualities(videoObj).map((q) => {
    const hevc = isHevc(q.codec);
    const resolutionTag = Math.min(q.width || 0, q.height || 0) || 'hd';
    const wrapped = wrap(q.url, `${base}_${resolutionTag}p${hevc ? '_hevc' : ''}`);
    return {
      width: q.width,
      height: q.height,
      bitrate: q.bitrate,
      codec: q.codec,
      size: q.size,
      hevc,
      ...wrapped,
    };
  });

  const musicObj = item.music || {};
  const musicPlayUrl = firstUrl(musicObj.playUrl);
  const wrappedMusic = musicPlayUrl ? wrap(musicPlayUrl, `${base}_music`) : null;
  const firstQuality = qualities[0];

  return {
    id: itemId,
    type: images.length > 0 ? 'photo' : 'video',
    url: pageUrl,
    desc: typeof item.desc === 'string' ? item.desc : '',
    created: num(item.createTime),
    author: {
      id: typeof author.uniqueId === 'string' ? author.uniqueId : '',
      name:
        (typeof author.nickname === 'string' && author.nickname) ||
        (typeof author.uniqueId === 'string' ? author.uniqueId : ''),
      verified: Boolean(author.verified),
      avatar: asset(
        author.avatarLarger || author.avatarMedium || author.avatarThumb,
        `${base}_avatar`,
      ),
    },
    stats: {
      plays: num(statsPrimary.playCount ?? statsFallback.playCount),
      likes: num(statsPrimary.diggCount ?? statsFallback.diggCount),
      comments: num(statsPrimary.commentCount ?? statsFallback.commentCount),
      shares: num(statsPrimary.shareCount ?? statsFallback.shareCount),
      saves: num(statsPrimary.collectCount ?? statsFallback.collectCount),
    },
    music: wrappedMusic
      ? {
          title:
            typeof musicObj.title === 'string' && musicObj.title
              ? musicObj.title
              : 'Original sound',
          author: typeof musicObj.authorName === 'string' ? musicObj.authorName : '',
          duration: num(musicObj.duration),
          original: Boolean(musicObj.original),
          cover: asset(
            musicObj.coverLarge || musicObj.coverMedium || musicObj.coverThumb,
            `${base}_music_cover`,
          ),
          ...wrappedMusic,
        }
      : null,
    cover: asset(
      videoObj.originCover || videoObj.cover || videoObj.dynamicCover,
      `${base}_cover`,
    ),
    video:
      images.length === 0 && firstQuality
        ? {
            width: firstQuality.width,
            height: firstQuality.height,
            duration: num(videoObj.duration),
            dl: firstQuality.dl,
            src: firstQuality.src,
            qualities,
          }
        : null,
    images,
  };
}

function normalizeTikwmData(data, wrap, pageUrl) {
  const author = data.author || {};
  const musicInfo = data.music_info || {};
  const itemId = String(data.id ?? '');
  const uniqueId = typeof author.unique_id === 'string' ? author.unique_id : '';
  const base = `tiktok_${slug(uniqueId)}_${itemId}`;

  const toAbsoluteHttps = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    if (/^https:\/\//i.test(raw)) return raw;
    if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
    if (raw.startsWith('/')) return `https://www.tikwm.com${raw}`;
    return '';
  };

  const asset = (raw, name) => {
    const abs = toAbsoluteHttps(raw);
    if (!abs) return null;
    try {
      if (!isMediaHost(new URL(abs).hostname)) return null;
      return wrap(abs, name);
    } catch {
      return null;
    }
  };

  const rawImages = Array.isArray(data.images) ? data.images : [];
  const images = [];
  rawImages.forEach((rawUrl, index) => {
    const wrapped = asset(rawUrl, `${base}_${pad(index + 1)}`);
    if (!wrapped) return;
    images.push({
      index,
      width: 0,
      height: 0,
      ...wrapped,
      live: null,
    });
  });

  const qualities = [];
  const pushQuality = (rawUrl, width, height, size, suffix) => {
    const abs = toAbsoluteHttps(rawUrl);
    if (!abs) return;
    try {
      if (!isMediaHost(new URL(abs).hostname)) return;
    } catch {
      return;
    }
    const wrapped = wrap(abs, `${base}_${suffix}`);
    if (qualities.some((q) => q.dl === wrapped.dl)) return;
    qualities.push({
      width,
      height,
      bitrate: 0,
      codec: 'h264',
      size,
      hevc: false,
      ...wrapped,
    });
  };

  if (images.length === 0) {
    const hdUrl = toAbsoluteHttps(data.hdplay);
    const sdUrl = toAbsoluteHttps(data.play);
    if (hdUrl && hdUrl !== sdUrl) {
      pushQuality(hdUrl, 1080, 1920, num(data.hd_size), '1080p');
    }
    if (sdUrl) {
      pushQuality(sdUrl, 720, 1280, num(data.size), '720p');
    }
  }

  const musicUrl = toAbsoluteHttps(musicInfo.play || data.music);
  const wrappedMusic = musicUrl ? asset(musicUrl, `${base}_music`) : null;
  const coverAsset = asset(
    data.origin_cover || data.cover || data.ai_dynamic_cover,
    `${base}_cover`,
  );
  const firstQuality = qualities[0];

  return {
    id: itemId,
    type: images.length > 0 ? 'photo' : 'video',
    url: pageUrl,
    desc: typeof data.title === 'string' ? data.title : '',
    created: num(data.create_time),
    author: {
      id: uniqueId,
      name: (typeof author.nickname === 'string' && author.nickname) || uniqueId,
      verified: false,
      avatar: asset(author.avatar, `${base}_avatar`),
    },
    stats: {
      plays: num(data.play_count),
      likes: num(data.digg_count),
      comments: num(data.comment_count),
      shares: num(data.share_count),
      saves: num(data.collect_count),
    },
    music: wrappedMusic
      ? {
          title:
            typeof musicInfo.title === 'string' && musicInfo.title
              ? musicInfo.title
              : 'Original sound',
          author: typeof musicInfo.author === 'string' ? musicInfo.author : '',
          duration: num(musicInfo.duration ?? data.duration),
          original: Boolean(musicInfo.original),
          cover: asset(musicInfo.cover, `${base}_music_cover`),
          ...wrappedMusic,
        }
      : null,
    cover: coverAsset,
    video:
      images.length === 0 && firstQuality
        ? {
            width: firstQuality.width,
            height: firstQuality.height,
            duration: num(data.duration),
            dl: firstQuality.dl,
            src: firstQuality.src,
            qualities,
          }
        : null,
    images,
  };
}

async function fetchTikwmFallback(targetUrl, { timeoutMs, fetcher }) {
  const endpoint = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`;
  let res;
  try {
    res = await fetcher(endpoint, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
      },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  if (json?.code !== 0 || !json.data || typeof json.data !== 'object') {
    return null;
  }

  const wrap = (url, name) => {
    const dl = `/api/dl?t=${encodeToken({ u: url, c: '' })}&n=${encodeURIComponent(name)}`;
    return { dl, src: `${dl}&inline=1` };
  };

  const normalized = normalizeTikwmData(json.data, wrap, targetUrl);
  if (!normalized.id || (!normalized.video && normalized.images.length === 0)) {
    return null;
  }
  return normalized;
}

/* ---------- Fetch and parse TikTok page (with automatic WAF fallback) ---------- */
export async function getInfo(input, { timeoutMs = 15_000, fetcher = fetch } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(input).trim());
  } catch {
    throw new HttpError(400, 'invalid_url', 'Please enter a valid link.');
  }

  if (!/^https?:$/i.test(parsedUrl.protocol) || !isPageHost(parsedUrl.hostname)) {
    throw new HttpError(400, 'invalid_url', 'That does not look like a TikTok link.');
  }
  parsedUrl.protocol = 'https:';

  let page = null;
  let primaryError = null;

  try {
    page = await fetchFollow(parsedUrl.href, {
      hostOk: isPageHost,
      signal: AbortSignal.timeout(timeoutMs),
      fetcher,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 400) throw error;
      primaryError = error;
    } else {
      primaryError = new HttpError(504, 'upstream_timeout', 'TikTok did not respond in time.');
    }
  }

  const canonicalUrl = page ? page.url.origin + page.url.pathname : parsedUrl.href;

  if (page) {
    const html = await page.res.text();
    const match = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );

    if (match?.[1]) {
      try {
        const data = JSON.parse(match[1]);
        const detail = data?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
        const item = detail?.itemInfo?.itemStruct;

        if (item) {
          let cookie = [...page.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
          if (cookie.length > 1800) {
            cookie = cookie.slice(0, 1800).replace(/;[^;]*$/, '');
          }
          const wrap = (url, name) => {
            const dl = `/api/dl?t=${encodeToken({ u: url, c: cookie })}&n=${encodeURIComponent(name)}`;
            return { dl, src: `${dl}&inline=1` };
          };
          return normalize(item, wrap, canonicalUrl);
        }

        const gone = typeof detail?.statusCode === 'number' && detail.statusCode !== 0;
        if (gone) {
          throw new HttpError(
            404,
            'not_found',
            'This post was not found, is private, or has been removed.',
          );
        }
        primaryError = new HttpError(
          502,
          'parse_failed',
          'Could not find video details on the page.',
        );
      } catch (error) {
        if (error instanceof HttpError) throw error;
        primaryError = new HttpError(502, 'parse_failed', 'Could not read the TikTok page data.');
      }
    } else {
      primaryError = new HttpError(
        502,
        'blocked',
        'TikTok blocked this request or the page structure changed.',
      );
    }
  }

  // Automatic zero-.env fallback when TikTok serves SlardarWAF / captcha to datacenter IPs
  const fallbackResult = await fetchTikwmFallback(canonicalUrl, { timeoutMs, fetcher });
  if (fallbackResult) {
    return fallbackResult;
  }

  throw (
    primaryError ??
    new HttpError(502, 'blocked', 'Could not fetch this TikTok post. Check that it is public.')
  );
}
