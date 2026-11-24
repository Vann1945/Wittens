import { Readable } from "node:stream";
import { UA, HttpError, decodeToken, fetchFollow, isMediaHost } from "../lib/tiktok.js";

const EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/avif": "avif", "video/mp4": "mp4", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
};

export default async function handler(req, res) {
  const fail = (status, code) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code } }));
  };
  if (req.method !== "GET") return fail(405, "method");

  const q = new URL(req.url, "http://localhost").searchParams;
  let token;
  try { token = decodeToken(q.get("t")); } catch { return fail(400, "bad_token"); }
  if (typeof token?.u !== "string") return fail(400, "bad_token");

  const name = String(q.get("n") || "tiktok").replace(/[^\w.\-]+/g, "_").slice(0, 100) || "tiktok";
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  try {
    const headers = { "User-Agent": UA, Referer: "https://www.tiktok.com/" };
    if (token.c) headers.Cookie = String(token.c).slice(0, 2000);
    if (req.headers.range) headers.Range = req.headers.range;

    const { res: up } = await fetchFollow(token.u, { headers, hostOk: isMediaHost, signal: ac.signal });
    if (!up.ok && up.status !== 206) return fail(up.status === 403 ? 403 : 502, "upstream_" + up.status);

    const type = (up.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    let ext = EXT[type];
    if (!ext) ext = (new URL(token.u).pathname.match(/\.(\w{2,4})$/) || [])[1] || "bin";
    const filename = `${name}.${ext}`;

    res.statusCode = up.status;
    res.setHeader("Content-Type", type);
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Content-Disposition", `${q.get("inline") ? "inline" : "attachment"}; filename="${filename}"`);
    res.setHeader("X-Filename", filename);
    res.setHeader("Cache-Control", "private, max-age=300");

    if (!up.body) return res.end();
    Readable.fromWeb(up.body).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return fail(e.status, e.code);
    fail(502, "upstream_failed");
  }
}
