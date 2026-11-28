export function parseCaptionAndHashtags(raw: string): {
  caption: string;
  hashtags: string[];
} {
  const safeRaw = typeof raw === 'string' ? raw : '';
  const matches = safeRaw.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const tag of matches) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      hashtags.push(tag);
    }
  }

  const caption = safeRaw
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { caption, hashtags };
}

export function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[,.;:!?-]+$/, '').trim();
}
