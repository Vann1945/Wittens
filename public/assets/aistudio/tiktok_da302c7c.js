/* Pengambil data TikTok: baca JSON bawaan halaman (SSR), lalu normalkan.
   Semua URL media dibungkus token agar diunduh lewat /api/dl, karena CDN
   TikTok menolak request tanpa Referer dan cookie dari sesi halaman. */

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/* ---------- allowlist host (cegah SSRF) ---------- */
const suffixOk = (h, s) => h === s || h.endsWith("." + s);
const PAGE_HOSTS = ["tiktok.com"];
const MEDIA_HOSTS = [
  "tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com",
  "tiktokv.com", "tiktokv.us", "tiktokv.eu", "byteoversea.com",
  "ibytedtos.com", "ibyteimg.com", "muscdn.com",
];
export const isPageHost = (h) => PAGE_HOSTS.some((s) => suffixOk(h, s));
export const isMediaHost = (h) =>
  MEDIA_HOSTS.some((s) => suffixOk(h, s)) || /^v\d+[a-z-]*\.akamaized\.net$/.test(h);

const readCookies = (res) => {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") || "").split(/,(?=\s*[\w-]+=)/);
  return list.map((c) => c.split(";")[0].trim()).filter(Boolean);
};

/* Ikuti redirect manual supaya setiap hop divalidasi. */
export async function fetchFollow(url, { headers = {}, hostOk, signal, maxHops = 5 } = {}) {
  let u = new URL(url);
  const jar = new Map();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (u.protocol !== "https:" || !hostOk(u.hostname)) {
      throw new HttpError(400, "invalid_url", "Host tidak diizinkan.");
    }
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(u, {
      redirect: "manual", signal,
      headers: { ...headers, ...(cookie ? { Cookie: [headers.Cookie, cookie].filter(Boolean).join("; ") } : {}) },
    });
    for (const c of readCookies(res)) {
      const i = c.indexOf("=");
      if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { u = new URL(loc, u); continue; }
    return { res, url: u, cookies: jar };
  }
  throw new HttpError(502, "too_many_redirects", "Terlalu banyak pengalihan.");
}

/* ---------- token media ---------- */
export const encodeToken = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
export const decodeToken = (t) => JSON.parse(Buffer.from(String(t), "base64url").toString("utf8"));

/* ---------- normalisasi ---------- */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const firstUrl = (x, depth = 0) => {
  if (!x || depth > 3) return "";
  if (typeof x === "string") return /^https?:\/\//.test(x) ? x : "";
  if (Array.isArray(x)) return firstUrl(x[0], depth + 1);
  for (const k of ["urlList", "UrlList", "playAddr", "PlayAddr", "url", "Url", "src"]) {
    if (x[k]) { const r = firstUrl(x[k], depth + 1); if (r) return r; }
  }
  return "";
};

const preferJpeg = (list = []) =>
  list.find((u) => /\.jpe?g(\?|$)/i.test(u)) || list.find((u) => /\.png(\?|$)/i.test(u)) || list[0] || "";

/* Cari video pendamping foto (live photo). Nama field-nya tidak terdokumentasi,
   jadi dicari lewat key yang mengandung video/live/motion/animat. */
const LIVE_SKIP = new Set(["imageURL", "displayImage", "ownerWatermarkImage", "thumbnail", "imageWidth", "imageHeight"]);
export function findLive(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return "";
  for (const [k, v] of Object.entries(node)) {
    if (LIVE_SKIP.has(k)) continue;
    if (/video|live|motion|animat/i.test(k)) {
      const u = firstUrl(v);
      if (u) return u;
    }
    if (v && typeof v === "object") {
      const r = findLive(v, depth + 1);
      if (r) return r;
    }
  }
  return "";
}

/* Semua varian video (bitrateInfo) diurutkan: resolusi tertinggi dulu,
   H.264 lebih dulu dari HEVC pada resolusi sama (kompatibel di semua pemutar),
   lalu bitrate tertinggi. */
const isHevc = (c) => /265|hevc|bytevc/i.test(c);
export function videoQualities(v) {
  const out = [];
  const push = (url, o) => { if (url && !out.some((x) => x.url === url)) out.push({ url, ...o }); };
  for (const b of v.bitrateInfo || []) {
    const pa = b.PlayAddr || b.playAddr || {};
    push(firstUrl(pa), {
      width: num(pa.Width ?? pa.width), height: num(pa.Height ?? pa.height),
      bitrate: num(b.Bitrate ?? b.bitrate), codec: String(b.CodecType ?? b.codecType ?? ""),
      size: num(pa.DataSize ?? pa.dataSize),
    });
  }
  push(firstUrl(v.playAddr) || firstUrl(v.downloadAddr), {
    width: num(v.width), height: num(v.height), bitrate: num(v.bitrate), codec: "",
    size: num(v.playAddr?.DataSize),
  });
  const side = (q) => Math.min(q.width || 0, q.height || 0);
  return out.sort((a, b) =>
    side(b) - side(a) ||
    (isHevc(a.codec) ? 1 : 0) - (isHevc(b.codec) ? 1 : 0) ||
    b.bitrate - a.bitrate);
}

const slug = (s) => String(s || "x").replace(/[^\w.\-]+/g, "_").slice(0, 40);
const pad = (n) => String(n).padStart(2, "0");

/* `wrap(url, name)` mengubah URL CDN menjadi { dl, src } milik server kita. */
export function normalize(item, wrap, pageUrl = "") {
  const a = typeof item.author === "string" ? { uniqueId: item.author } : (item.author || {});
  const s = item.statsV2 || item.stats || {};
  const s0 = item.stats || {};
  const base = `tiktok_${slug(a.uniqueId)}_${item.id}`;
  const asset = (u, name) => (u ? wrap(u, name) : null);

  const images = (item.imagePost?.images || []).map((im, i) => {
    const url = preferJpeg(im.imageURL?.urlList);
    const live = findLive(im);
    return {
      index: i,
      width: num(im.imageWidth), height: num(im.imageHeight),
      ...asset(url, `${base}_${pad(i + 1)}`),
      live: live ? asset(live, `${base}_${pad(i + 1)}_live`) : null,
    };
  }).filter((im) => im.dl);

  const v = item.video || {};
  const quals = videoQualities(v).map((q) => ({
    ...q, hevc: isHevc(q.codec),
    ...wrap(q.url, `${base}_${Math.min(q.width || 0, q.height || 0) || "hd"}p${isHevc(q.codec) ? "_hevc" : ""}`),
  })).map(({ url, ...rest }) => rest);
  const m = item.music || {};

  return {
    id: String(item.id),
    type: images.length ? "photo" : "video",
    url: pageUrl,
    desc: item.desc || "",
    created: num(item.createTime),
    author: {
      id: a.uniqueId || "", name: a.nickname || a.uniqueId || "",
      verified: !!a.verified,
      avatar: asset(a.avatarLarger || a.avatarMedium || a.avatarThumb, `${base}_avatar`),
    },
    stats: {
      plays: num(s.playCount ?? s0.playCount),
      likes: num(s.diggCount ?? s0.diggCount),
      comments: num(s.commentCount ?? s0.commentCount),
      shares: num(s.shareCount ?? s0.shareCount),
      saves: num(s.collectCount ?? s0.collectCount),
    },
    music: firstUrl(m.playUrl)
      ? {
          title: m.title || "Suara asli", author: m.authorName || "",
          duration: num(m.duration), original: !!m.original,
          cover: asset(m.coverLarge || m.coverMedium || m.coverThumb, `${base}_music_cover`),
          ...asset(firstUrl(m.playUrl), `${base}_music`),
        }
      : null,
    cover: asset(v.originCover || v.cover || v.dynamicCover, `${base}_cover`),
    video: !images.length && quals.length
      ? { width: quals[0].width, height: quals[0].height, duration: num(v.duration), dl: quals[0].dl, src: quals[0].src, qualities: quals }
      : null,
    images,
  };
}

/* ---------- ambil halaman ---------- */
export async function getInfo(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new HttpError(400, "invalid_url", "Tautan tidak valid."); }
  if (!/^https?:$/.test(u.protocol) || !isPageHost(u.hostname)) {
    throw new HttpError(400, "invalid_url", "Bukan tautan TikTok.");
  }
  u.protocol = "https:";

  let page;
  try {
    page = await fetchFollow(u.href, {
      hostOk: isPageHost, signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml" },
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, "upstream_timeout", "TikTok tidak merespons.");
  }

  const html = await page.res.text();
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    throw new HttpError(502, "blocked", "TikTok memblokir server ini (captcha atau IP datacenter) atau struktur halaman berubah.");
  }

  let data;
  try { data = JSON.parse(m[1]); } catch { throw new HttpError(502, "parse_failed", "Data halaman tidak terbaca."); }
  const detail = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  const item = detail?.itemInfo?.itemStruct;
  if (!item) {
    const gone = detail?.statusCode && detail.statusCode !== 0;
    throw new HttpError(gone ? 404 : 502, gone ? "not_found" : "parse_failed",
      gone ? "Konten tidak ditemukan, privat, atau sudah dihapus." : "Data konten tidak ditemukan di halaman.");
  }

  let cookie = [...page.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie.length > 1800) cookie = cookie.slice(0, 1800).replace(/;[^;]*$/, "");

  const wrap = (url, name) => {
    const dl = `/api/dl?t=${encodeToken({ u: url, c: cookie })}&n=${encodeURIComponent(name)}`;
    return { dl, src: `${dl}&inline=1` };
  };
  return normalize(item, wrap, page.url.origin + page.url.pathname);
}
