/**
 * Release notes registry.
 *
 * To add a new release: create a file (e.g., `2026-04.ts`), import it here,
 * and add it to ALL_RELEASE_NOTES. The array is sorted newest-first.
 */

import { RELEASE_2026_03 } from './2026-03';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReleaseNote {
  /** Date-based version, e.g., '2026.03' */
  version: string;
  /** ISO date */
  date: string;
  /** Display label, e.g., 'march 2026' */
  month: string;
  features: Array<{
    title: { en: string; beanie: string };
    description: { en: string; beanie: string };
    icon?: string;
    /** Route for "try it →" button */
    tryItRoute?: string;
  }>;
  fixes?: Array<{ text: { en: string; beanie: string } }>;
  signature?: string;
}

// ── Registry (newest first) ──────────────────────────────────────────────────

const ALL_RELEASE_NOTES: ReleaseNote[] = [RELEASE_2026_03];

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
