export type Service = 'tiktok';

const URL_IN_TEXT = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*tiktok\.com\/[^\s<>"')]+/i;

/** Pulls the first TikTok link out of free text (e.g. a share message). */
export function extractUrl(text: string): string | null {
  const match = text.match(URL_IN_TEXT);
  return match ? match[0].replace(/[.,!?;:]+$/, '') : null;
}

function isTikTokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'tiktok.com' || host.endsWith('.tiktok.com');
}

export interface ParsedLink {
  service: Service;
  url: URL;
}

/**
 * Validates user input and identifies the service it belongs to.
 * Returns null for anything that is not a plain http(s) TikTok link.
 */
export function parseLink(raw: string): ParsedLink | null {
  const candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(extractUrl(candidate) ?? candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  if (!isTikTokHost(url.hostname)) return null;

  url.protocol = 'https:';
  url.port = '';
  url.hash = '';
  return { service: 'tiktok', url };
}
