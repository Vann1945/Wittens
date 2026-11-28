export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: { code: 'method', message: 'Use GET.' } }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, scraper: 'tiktok' }));
}
