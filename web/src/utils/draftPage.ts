/**
 * Draft flag for standalone Astro pages (glossary, FAQ, etc — anything that
 * isn't a markdown content-collection entry with its own `draft` frontmatter).
 *
 * Usage at the top of a page:
 *
 *   ---
 *   import { isDraftHidden } from '~/utils/draftPage';
 *   const DRAFT = true;
 *   const hidden = isDraftHidden(DRAFT);
 *   ---
 *
 *   {hidden ? <DraftPlaceholder /> : <RealContent />}
 *
 * In prod builds, the placeholder renders with a noindex meta tag so search
 * engines + AI crawlers skip it. In `npm run dev:web`, full content renders
 * for local iteration.
 */
export function isDraftHidden(draft: boolean): boolean {
  return draft && !import.meta.env.DEV;
}
