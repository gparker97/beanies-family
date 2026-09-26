/**
 * Canonical localStorage keys.
 *
 * The settings store mirrors a small set of appearance preferences to
 * localStorage on every change so the synchronous bootstrap script in
 * `index.html` can apply them before any CSS loads (avoiding FOUC). The
 * IndexedDB / Automerge layers remain the durable source of truth and
 * confirm or correct the bootstrap shortly after Vue mounts.
 *
 * Important: the bootstrap script in `index.html` cannot import this file
 * (it runs as inline JS before module loading), so it duplicates these
 * literals. Keep both places in sync — if you rename a key here, update
 * `index.html` in the same commit.
 */
export const STORAGE_KEYS = {
  TEXT_SIZE: 'beanies:textSize',
  THEME: 'beanies:theme',
  /** Who Owns What (#109): the last-used view (overview / deal / deck). Device-local;
   *  not read by the `index.html` bootstrap. */
  WHO_OWNS_WHAT_VIEW: 'beanies:whoOwnsWhatView',
} as const;
