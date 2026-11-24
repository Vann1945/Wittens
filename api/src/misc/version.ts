import { readFileSync } from 'node:fs';

/** Reads the version from api/package.json (same relative location for src/ and dist/). */
export function getVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
