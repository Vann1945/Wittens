import { config as loadDotenv } from 'dotenv';

export interface Config {
  /** Port the server listens on. */
  port: number;
  /** Interface the server binds to. */
  host: string;
  /** Whether the server is running in production mode. */
  isProd: boolean;
  /** Optional path to static frontend build in production. */
  webDistPath: string | null;
  /** `*` or a single origin. When null, no CORS headers are sent (same-origin only). */
  corsOrigin: string | null;
  /** Number of reverse proxies in front of the server (Express `trust proxy`). */
  trustProxy: number;
  /** Rate limit window duration in milliseconds. */
  rateLimitWindowMs: number;
  /** Max /api/info requests per client per window. */
  infoRateLimitMax: number;
  /** Max /api/dl requests per client per window. */
  downloadRateLimitMax: number;
  /** Time budget in milliseconds for upstream TikTok requests. */
  upstreamTimeoutMs: number;
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

function readCorsOrigin(env: Env): string | null {
  const raw = readString(env, 'CORS_ORIGIN');
  if (!raw || raw === '*') return raw;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`CORS_ORIGIN must be "*" or a valid origin (got "${raw}")`);
  }
}

/** Loads a `.env` file into process.env. Existing environment variables always take precedence. */
export function loadEnvFile(env: Env = process.env): void {
  loadDotenv({ path: env.API_ENV_FILE || undefined, quiet: true });
}

export function loadConfig(env: Env = process.env): Config {
  const isProd = env.NODE_ENV === 'production';
  const portRaw = env.API_PORT ?? env.PORT;
  const portEnv = portRaw !== undefined ? { API_PORT: portRaw } : {};

  return {
    port: readInt(portEnv, 'API_PORT', 3000, 1, 65535),
    host: readString(env, 'API_LISTEN_ADDRESS') ?? '0.0.0.0',
    isProd,
    webDistPath: readString(env, 'WEB_DIST_PATH') ?? (isProd ? 'dist' : null),
    corsOrigin: readCorsOrigin(env),
    trustProxy: readInt(env, 'TRUST_PROXY', 1, 0, 10),
    rateLimitWindowMs: readInt(env, 'RATELIMIT_WINDOW', 60, 1, 86_400) * 1000,
    infoRateLimitMax: readInt(env, 'RATELIMIT_MAX', 20, 1, 10_000),
    downloadRateLimitMax: readInt(env, 'DOWNLOAD_RATELIMIT_MAX', 120, 1, 100_000),
    upstreamTimeoutMs: readInt(env, 'UPSTREAM_TIMEOUT', 15, 1, 120) * 1000,
  };
}
