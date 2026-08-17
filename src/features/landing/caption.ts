// Pure caption formatting, kept out of instagram.ts so it can be unit-tested:
// that module imports 'server-only', which refuses to load outside a server
// component and would take the test file down with it.

/**
 * The one line of an Instagram caption worth showing under a thumbnail.
 *
 * Captions are written for Instagram — several lines, emoji, and a block of
 * hashtags at the end — so this takes the first line that actually says
 * something and strips the hashtags trailing it.
 */
export function captionHeadline(caption: string | null, max = 90): string | null {
  if (!caption) return null;
  const firstLine = caption
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!firstLine) return null;
  // Only hashtags RUN TOGETHER AT THE END go: "Lote #12 disponible" keeps its #.
  const clean = firstLine.replace(/(\s+#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
