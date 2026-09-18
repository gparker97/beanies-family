/**
 * Family-file extension matching, in one place.
 *
 * ⚠️ TWO PREDICATES, NOT ONE, AND THE DIFFERENCE IS LOAD-BEARING. The five sites that used to
 * open-code this were not all doing the same test: four of them accept `.json` as well as
 * `.beanpod`, because that is what the app wrote before the format was renamed and what a restore
 * from an old export still offers. Collapsing them onto a single strict `.beanpod` test would
 * silently drop `.json` from the load and drag-drop paths, which is a user-facing regression on
 * exactly the restore route a family with a broken pod is steered towards.
 *
 * So:
 *   - `isBeanpodFileName` is STRICT. Use it where claiming a `.json` would be wrong, i.e. the
 *     share sheet, where a shared `.json` belongs to whatever else can read it.
 *   - `isPodFileName` / `POD_FILE_ACCEPT` are the PAIR. Use them wherever the app is offering to
 *     open a family file the user already has.
 *
 * ⚠️ CASE-INSENSITIVE, WHICH IS A DELIBERATE WIDENING. The `endsWith` checks these replaced were
 * case-sensitive. Share-sheet and cloud-download filenames are not under our control, so a
 * `.BEANPOD` that is rejected today is accepted now. That is the safe direction (it opens a file
 * that is genuinely ours rather than refusing it) and it has its own test rather than riding along
 * unnoticed.
 *
 * ⚠️ NOT FOR BUILDING FILE NAMES. The other `.beanpod` literals in the app (default names like
 * `family.beanpod`, the Picker's `*.beanpod` view queries, the Drive search query) are not
 * extension tests; folding them in here would touch ten files, read worse, and buy nothing.
 */

/** The family-file extension, lowercase, with the dot. */
export const BEANPOD_EXT = '.beanpod';

/** The legacy extension the app wrote before the rename. Still openable, never suggested. */
const LEGACY_POD_EXT = '.json';

/** Both extensions an "open a family file" affordance accepts. Order is user-visible. */
export const POD_FILE_ACCEPT: readonly string[] = [BEANPOD_EXT, LEGACY_POD_EXT];

/** Strictly a `.beanpod`. See the header for when to prefer this over `isPodFileName`. */
export function isBeanpodFileName(name: string): boolean {
  return name.toLowerCase().endsWith(BEANPOD_EXT);
}

/** A `.beanpod` OR a legacy `.json`. The test the four existing load paths have always made. */
export function isPodFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return POD_FILE_ACCEPT.some((ext) => lower.endsWith(ext));
}
