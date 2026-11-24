import { getInfo, HttpError } from "../lib/tiktok.js";

export default async function handler(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") return send(405, { error: { code: "method", message: "Gunakan GET." } });

  const url = new URL(req.url, "http://localhost").searchParams.get("url") || "";
  try {
    send(200, await getInfo(url));
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: { code: e.code, message: e.message } });
    console.error("[info]", e);
    send(500, { error: { code: "internal", message: "Kesalahan di server." } });
  }
}
