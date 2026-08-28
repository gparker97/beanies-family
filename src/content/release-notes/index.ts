/**
 * Release notes registry.
 *
 * Two kinds of entry, both `ReleaseNote`, merged here newest-first:
 *  - **Curated monthly releases** — rich `features` cards, their own file
 *    (e.g. `2026-04.ts`). Add a file, import it, and list it below.
 *  - **Per-deploy notes** — the steady stream of brief one-liners authored at
 *    deploy time, all living in `deploys.ts`. The deploy skill appends them
 *    (see `scripts/deploy/release-note-guide.md`); no new file/import needed.
 *
 * Each entry is bundled into the app, so a deploy that adds one ships it to all
 * clients — the `whats-new` notification derives from it on the next update
 * (the same moment as the "fresh beans loaded" toast).
 */

import { RELEASE_2026_03 } from './2026-03';
import { RELEASE_2026_04 } from './2026-04';
import { DEPLOY_NOTES } from './deploys';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReleaseNote {
  /** Date-based version — `'2026.04'` (monthly) or `'2026.05.27'` / `'2026.05.27.2'` (per-deploy). Sorts lexicographically; the migration relies on that. */
  version: string;
  /** ISO date */
  date: string;
  /** Display label, e.g., 'march 2026' (monthly) or '27 may 2026' (per-deploy) */
  month: string;
  /**
   * Brief one-line message for a per-deploy note — the at-a-glance row summary
   * and the detail body when there are no `features` cards. Omitted for the
   * curated monthly releases (which use `features`).
   */
  summary?: { en: string; beanie: string };
  /**
   * Auto-open the notifications drawer on login. Significant releases only;
   * minor per-deploy notes just badge the bell. See `isSpotlightRelease` for
   * the default (true when the note has feature cards).
   */
  spotlight?: boolean;
  features?: Array<{
    title: { en: string; beanie: string };
    description: { en: string; beanie: string };
    icon?: string;
    /** Route for "try it →" button */
    tryItRoute?: string;
    /** Optional label overriding the generic "Try It" on the tryItRoute button. */
    tryItLabel?: { en: string; beanie: string };
    /**
     * Turn a phrase that appears inside `description` into an external link
     * (e.g. a help article). The phrase must be a verbatim substring of the
     * description; if it isn't found the description renders as plain text.
     */
    descriptionLink?: { phrase: { en: string; beanie: string }; href: string };
    /** A trailing call-to-action that opens an external URL in a new tab. */
    cta?: { label: { en: string; beanie: string }; href: string };
  }>;
  fixes?: Array<{ text: { en: string; beanie: string } }>;
  signature?: string;
}

// ── Registry (newest first) ──────────────────────────────────────────────────

// Merge the per-deploy stream with the curated monthly releases, newest-first
// by date (version is the tiebreak for multiple same-day deploys).
const ALL_RELEASE_NOTES: ReleaseNote[] = [...DEPLOY_NOTES, RELEASE_2026_04, RELEASE_2026_03].sort(
  (a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version)
);

/**
 * Whether a release auto-opens the drawer (vs. only badging the bell). Defaults
 * to "yes" for notes with feature cards (the rich, significant releases); brief
 * per-deploy notes opt in explicitly via `spotlight: true`.
 */
export function isSpotlightRelease(note: ReleaseNote): boolean {
  return note.spotlight ?? (note.features?.length ?? 0) > 0;
}

/**
 * Whether a post-update toast should offer a "what changed?" link to `note`.
 * True only when the note is a spotlight (non-trivial) release AND it is newer
 * than the version the user was last toasted about — so a minor "fixes &
 * improvements" note, OR a deploy that shipped no new note (version unchanged),
 * shows no link. `note` is the current latest release note.
 */
export function isWhatChangedRelease(
  note: ReleaseNote | undefined,
  lastToastedVersion: string
): boolean {
  if (!note || note.version === lastToastedVersion) return false;
  return isSpotlightRelease(note);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getLatestVersion(): string {
  return ALL_RELEASE_NOTES[0]?.version ?? '';
}

export function getLatestReleaseNote(): ReleaseNote | undefined {
  return ALL_RELEASE_NOTES[0];
}

export function getAllReleaseNotes(): readonly ReleaseNote[] {
  return ALL_RELEASE_NOTES;
}

export function getReleaseNote(version: string): ReleaseNote | undefined {
  return ALL_RELEASE_NOTES.find((n) => n.version === version);
}
