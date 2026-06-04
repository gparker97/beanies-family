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
  {
    version: '2026.06.04',
    date: '2026-06-04',
    month: '4 june 2026',
    summary: {
      en: 'Minor bug fixes and improvements.',
      beanie: 'minor bug fixes and improvements.',
    },
  },
  {
    version: '2026.05.31',
    date: '2026-05-31',
    month: '31 may 2026',
    summary: {
      en: "Travel ideas can be skipped now, and the travel badge counts what's still open.",
      beanie: "travel ideas can be skipped now, and the travel badge counts what's still open.",
    },
  },
  {
    version: '2026.05.29',
    date: '2026-05-29',
    month: '29 may 2026',
    spotlight: true,
    summary: {
      en: "Today's tip lives in the bell.",
      beanie: "today's tip lives in the bell.",
    },
    features: [
      {
        title: {
          en: "Today's tip lives in the bell",
          beanie: "today's tip lives in the bell",
        },
        description: {
          en: "Each day brings a small tip from the beanies in your notification bell. Tap to read the full tip and try the feature it points to. Tips stay in your bell after you've read them, so you can always scroll back to one you liked. Turn them off in Settings if you'd rather not.",
          beanie:
            "each day brings a small tip from the beanies in your notification bell. tap to read the full tip and try the feature it points to. tips stay in your bell after you've read them, so you can always scroll back to one you liked. turn them off in settings if you'd rather not.",
        },
      },
      {
        title: {
          en: 'Mobile header has room to breathe',
          beanie: 'mobile header has room to breathe',
        },
        description: {
          en: 'The greeting on smaller phones no longer gets cut off. The peek-a-boo beanie eyes are still in the side menu and on every figure you tap.',
          beanie:
            'the greeting on smaller phones no longer gets cut off. the peek-a-boo beanie eyes are still in the side menu and on every figure you tap.',
        },
      },
    ],
  },
  {
    version: '2026.05.27',
    date: '2026-05-27',
    month: '27 may 2026',
    spotlight: true,
    // `summary` = the at-a-glance bell-row line. `features` = the headline +
    // detail block(s) in the note body (one here; list more for a multi-feature
    // deploy). See `scripts/deploy/release-note-guide.md`.
    summary: {
      en: 'Notifications are here!',
      beanie: 'notifications are here!',
    },
    features: [
      {
        icon: '🔔',
        title: {
          en: 'Notifications are here!',
          beanie: 'notifications are here!',
        },
        description: {
          en: "A friendly bell in the header now keeps track of what needs you: tasks coming due, things a family member assigns you, events you're part of, and what's new. Nothing slips through the cracks.",
          beanie:
            "a friendly bell in the header now keeps track of what needs you: tasks coming due, things a family member assigns you, events you're part of, and what's new. nothing slips through the cracks.",
        },
      },
    ],
  },
  // Newest first. The deploy skill prepends new entries here. A significant note
  // pairs a one-line `summary` (the bell row) with `features` (headline + detail
  // block per new thing — list several for a multi-feature deploy), e.g.:
  // {
  //   version: '2026.05.27',
  //   date: '2026-05-27',
  //   month: '27 may 2026',
  //   spotlight: true, // omit/false for minor "fixes & improvements" notes
  //   summary: { en: 'A short, warm one-liner.', beanie: 'a short, warm one-liner.' },
  //   features: [
  //     {
  //       title: { en: 'Short bold headline', beanie: 'short bold headline' },
  //       description: {
  //         en: 'A concise sentence on what it is and why it helps the family.',
  //         beanie: 'a concise sentence on what it is and why it helps the family.',
  //       },
  //       // icon: '✨',          // optional lead emoji (shown for a single-feature note)
  //       // tryItRoute: '/path', // optional "try it →" deep-link
  //     },
  //   ],
  // },
  //
  // A minor "fixes & improvements" deploy stays summary-only (no `features`,
  // `spotlight` omitted): { ..., summary: { en: '...', beanie: '...' } }.
];
