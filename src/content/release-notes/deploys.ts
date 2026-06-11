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
    version: '2026.06.12',
    date: '2026-06-12',
    month: '12 june 2026',
    spotlight: false,
    summary: {
      en: "The app now stays in portrait, so it won't flip when your phone's rotation is locked.",
      beanie:
        "the app now stays in portrait, so it won't flip when your phone's rotation is locked.",
    },
  },
  // 2026.06.08 "magic beans got smarter" note PARKED 2026-06-12 — AI reader is
  // soft-launched, not announced. Copy preserved in `deploys.parked.ts`.
  {
    version: '2026.06.07.2',
    date: '2026-06-07',
    month: '7 june 2026',
    spotlight: false,
    summary: {
      en: 'Help us grow beanies.family together on Discord.',
      beanie: 'help us grow beanies.family together on discord.',
    },
    features: [
      {
        icon: '💬',
        title: {
          en: 'Join the beanies community',
          beanie: 'join the beanies community',
        },
        description: {
          en: "We're building a community of early beanie families on Discord - help shape what we build, swap tips, hear what's coming next, or just have a chat. All our early beans are welcome. Come say hi.",
          beanie:
            "we're building a community of early beanie families on discord - help shape what we build, swap tips, hear what's coming next, or just have a chat. all our early beans are welcome. come say hi.",
        },
        cta: {
          label: { en: 'Join us on Discord', beanie: 'join us on discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  // 2026.06.07 "magic beans" launch spotlight PARKED 2026-06-12 — AI reader is
  // soft-launched, not announced. Copy preserved in `deploys.parked.ts`.
  // ⚠️ Re-launch under a FRESH version/date — re-adding 2026.06.07 won't
  // re-announce (already seen; de-dupes by version). See deploys.parked.ts.
  {
    version: '2026.06.05',
    date: '2026-06-05',
    month: '5 june 2026',
    spotlight: true,
    summary: {
      en: 'Keep your booking documents right with your trips.',
      beanie: 'keep your booking documents right with your trips.',
    },
    features: [
      {
        title: {
          en: 'Attach documents to your travel plans',
          beanie: 'attach documents to your travel plans',
        },
        description: {
          en: 'Add the images and PDFs of your bookings - e-tickets, hotel confirmations, rental agreements - onto each flight, stay, or transfer, so the paperwork is always there when you need it.',
          beanie:
            'add the images and pdfs of your bookings - e-tickets, hotel confirmations, rental agreements - onto each flight, stay, or transfer, so the paperwork is always there when you need it.',
        },
      },
    ],
  },
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
