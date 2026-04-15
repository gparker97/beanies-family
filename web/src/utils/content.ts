/**
 * Content helpers — shared filtering logic for draft entries.
 *
 * Any content collection (blog, guides) with a `draft` field in its frontmatter
 * should pipe results through `filterPublished()` so drafts stay local-only
 * and never ship to prod (no list page, no static path, no sitemap entry, no
 * RSS item).
 */

type MaybeDraft<T> = T & { data: { draft?: boolean } };

/**
 * Return true if an entry should be visible in the current build.
 *
 * - `npm run dev:web` → import.meta.env.DEV === true → all entries visible
 * - `npm run build` (production) → import.meta.env.DEV === false → drafts hidden
 *
 * Entries without a `draft` field (or with draft: false) are always visible.
 */
export function isPublished<T extends { data: { draft?: boolean } }>(entry: T): boolean {
  if (import.meta.env.DEV) return true;
  return !entry.data.draft;
}

/** Convenience: filter an array of entries with isPublished. */
export function filterPublished<T extends { data: { draft?: boolean } }>(entries: T[]): T[] {
  return entries.filter(isPublished);
}
