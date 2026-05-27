/**
 * Per-deploy release notes — the steady stream of brief "what's new" entries
 * authored at deploy time. The deploy skills prepend to this array on a Vue
 * deploy (see `scripts/deploy/release-note-guide.md`); the registry (`index.ts`)
 * merges them with the curated monthly releases and sorts newest-first.
 *
 * Most entries are a one-line `summary` (+ `month` as the display date). A
 * significant deploy sets `spotlight: true` so it auto-opens the drawer once;
 * minor ones just badge the bell.
 *
 * PUBLIC CONTENT: the repo is public and this ships in the JS bundle, so every
 * message here is effectively public. Keep them user-facing and benefit-framed;
 * NEVER name security-fix specifics or internals — a security deploy gets a
 * generic line. The granular record lives in `CHANGELOG.md`.
 */
import type { ReleaseNote } from './index';

export const DEPLOY_NOTES: ReleaseNote[] = [
  // Newest first. The deploy skill prepends new entries here, e.g.:
  // {
  //   version: '2026.05.27',
  //   date: '2026-05-27',
  //   month: '27 may 2026',
  //   spotlight: true, // omit/false for minor "fixes & improvements" notes
  //   summary: {
  //     en: 'A short, warm, benefit-led line in sentence case.',
  //     beanie: 'a short, warm, benefit-led line, all lowercase.',
  //   },
  // },
];
