/**
 * The root font size in px: 16 normally, larger in Large reading mode (which scales the root).
 * Read fresh on every call (never cached), so a reading-mode toggle applies at once. 16 when
 * there is no document (tests, SSR) or the value cannot be read.
 */
export function rootFontSizePx(): number {
  if (typeof document === 'undefined') return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
