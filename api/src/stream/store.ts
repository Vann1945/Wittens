import crypto from 'node:crypto';

export interface TunnelEntry {
  /** Upstream media URL. Never exposed to the client. */
  url: string;
  filename: string;
  contentType: string;
}

interface StoredTunnel extends TunnelEntry {
  expiresAt: number;
}

export interface TunnelStoreOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

/** Tokens are 18 random bytes, base64url encoded. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/**
 * Short-lived, in-memory map of opaque tokens to upstream media URLs.
 * The browser only ever sees the token, so it can't be pointed at arbitrary hosts.
 */
export class TunnelStore {
  private readonly entries = new Map<string, StoredTunnel>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TunnelStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  create(entry: TunnelEntry): string {
    this.sweep();
    // Map keeps insertion order, so the first key is always the oldest entry.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }

    const token = crypto.randomBytes(18).toString('base64url');
    this.entries.set(token, { ...entry, expiresAt: this.now() + this.ttlMs });
    return token;
  }

  get(token: string): TunnelEntry | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const stored = this.entries.get(token);
    if (!stored) return null;
    if (stored.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    const { url, filename, contentType } = stored;
    return { url, filename, contentType };
  }

  /** Drops every expired entry. */
  sweep(): void {
    const now = this.now();
    for (const [token, stored] of this.entries) {
      if (stored.expiresAt <= now) this.entries.delete(token);
    }
  }
}
