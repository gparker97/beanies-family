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

/**
 * Canonical pillar reading order. Mirrors the pillar sequence in Notion
 * (the source of truth for long-form content). Not chronological — these
 * guides are meant to be read as a curriculum, starting from the
 * emotional overwhelm problem and building up to the tooling layer.
 *
 * Shared between the guides library index (`/guides`) and each guide's
 * prev/next navigation so the two surfaces stay in lockstep. Any new
 * guide slug that isn't listed here sorts to the end of the walk.
 */
export const PILLAR_ORDER: readonly string[] = [
  'overwhelmed-family-planning',
  'family-organization',
  'family-finance-basics',
  'local-first-family-finance-planning-tools',
];

/** Compare-fn for sorting guides by their PILLAR_ORDER index. */
export function comparePillarOrder<T extends { data: { slug: string } }>(a: T, b: T): number {
  const ai = PILLAR_ORDER.indexOf(a.data.slug);
  const bi = PILLAR_ORDER.indexOf(b.data.slug);
  const aKey = ai === -1 ? PILLAR_ORDER.length : ai;
  const bKey = bi === -1 ? PILLAR_ORDER.length : bi;
  return aKey - bKey;
}
