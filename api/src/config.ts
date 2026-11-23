import { config as loadDotenv } from 'dotenv';

export interface Config {
  /** Port the API listens on. */
  port: number;
  /** Interface the API binds to. */
  host: string;
  /** Absolute or relative path to a built web app. When set, the API also serves it. */
  webDistPath: string | null;
  /** `*` or a single origin. When null, no CORS headers are sent (same-origin only). */
  corsOrigin: string | null;
  /** Number of reverse proxies in front of the API (Express `trust proxy`). */
  trustProxy: number;
  rateLimitWindowMs: number;
  /** Max /api/resolve requests per client per window. */
  rateLimitMax: number;
  /** Max stream/tunnel requests per client per window. */
  tunnelRateLimitMax: number;
  /** How long a resolved download link stays valid. */
  tunnelTtlMs: number;
  tunnelMaxEntries: number;
  /** Time budget for talking to the upstream resolver and for upstream media headers. */
  upstreamTimeoutMs: number;
  /** Endpoint of the upstream TikTok resolver. */
  providerApiUrl: string;
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

function readString(env: Env, key: string): string | null {
  const raw = env[key]?.trim();
  return raw ? raw : null;
}

function readHttpsUrl(env: Env, key: string, fallback: string): string {
  const raw = readString(env, key) ?? fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} must be a valid URL (got "${raw}")`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${key} must use http or https (got "${raw}")`);
  }
  return parsed.toString();
}

function readCorsOrigin(env: Env): string | null {
  const raw = readString(env, 'CORS_ORIGIN');
  if (!raw || raw === '*') return raw;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`CORS_ORIGIN must be "*" or a valid origin (got "${raw}")`);
  }
}

/** Loads a `.env` file into process.env. Variables that are already set always win. */
export function loadEnvFile(env: Env = process.env): void {
  loadDotenv({ path: env.API_ENV_FILE || undefined, quiet: true });
}

export function loadConfig(env: Env = process.env): Config {
  return {
    port: readInt(env, 'API_PORT', 3000, 1, 65535),
    host: readString(env, 'API_LISTEN_ADDRESS') ?? '0.0.0.0',
    webDistPath: readString(env, 'WEB_DIST_PATH'),
    corsOrigin: readCorsOrigin(env),
    trustProxy: readInt(env, 'TRUST_PROXY', 1, 0, 10),
    rateLimitWindowMs: readInt(env, 'RATELIMIT_WINDOW', 60, 1, 86_400) * 1000,
    rateLimitMax: readInt(env, 'RATELIMIT_MAX', 20, 1, 10_000),
    tunnelRateLimitMax: readInt(env, 'TUNNEL_RATELIMIT_MAX', 120, 1, 100_000),
    tunnelTtlMs: readInt(env, 'TUNNEL_LIFESPAN', 900, 10, 86_400) * 1000,
    tunnelMaxEntries: readInt(env, 'TUNNEL_MAX_ENTRIES', 500, 1, 100_000),
    upstreamTimeoutMs: readInt(env, 'UPSTREAM_TIMEOUT', 14, 1, 120) * 1000,
    providerApiUrl: readHttpsUrl(env, 'PROVIDER_API_URL', 'https://www.tikwm.com/api/'),
  };
}
