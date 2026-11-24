/** Builds a filesystem- and header-safe file name (ASCII only, no path characters). */
export function createFilename(base: string, extension: string): string {
  const cleaned = base
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${cleaned || 'tiktok_video'}.${extension}`;
}
