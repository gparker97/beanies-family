/**
 * PARKED release notes — authored but deliberately NOT live.
 *
 * This file is intentionally NOT imported anywhere, so nothing here reaches the
 * notifications drawer, the bell, or the auto-generated "What's New" help
 * articles. It is a holding pen that keeps the original copy under version
 * control (and type-checked against `ReleaseNote`) so it can be re-published
 * later without rewriting it from scratch.
 *
 * ── Parked on 2026-06-12 ──────────────────────────────────────────────────────
 * The AI "magic beans" reader is **soft-launched but not officially announced**
 * yet. The feature stays live in-app (the ✨ buttons + the gentle tips-of-the-day
 * stay), and the dedicated Magic Beans privacy/security help article stays — only
 * the in-app *announcements* below were pulled. Planned re-launch: ~1-2 weeks out,
 * AFTER the Google Calendar integration is announced first (with its own blog),
 * then the AI reader (with its own blog). Coordinate the timing in Notion, not here.
 *
 * ⚠️ DO NOT re-add these verbatim. The "what's new" notification de-dupes by
 * `version`, and `2026.06.07` already auto-opened for every client that updated
 * since June 7 — re-adding the same version would NOT re-announce it (seen clients
 * skip it; it sorts by its old date, buried below newer notes). To re-launch:
 * copy the entry into `deploys.ts`, set `version`/`date`/`month` to the actual
 * re-launch day (e.g. `2026.06.26`), keep `spotlight: true`, and refresh the copy
 * if the feature has moved on since.
 */
import type { ReleaseNote } from './index';

export const PARKED_AI_NOTES: ReleaseNote[] = [
  {
    version: '2026.06.08',
    date: '2026-06-08',
    month: '8 june 2026',
    spotlight: false,
    summary: {
      en: 'Your magic beans just got smarter at reading invites.',
      beanie: 'your magic beans just got smarter at reading invites.',
    },
    features: [
      {
        title: { en: 'Everything you need to bring', beanie: 'everything you need to bring' },
        description: {
          en: "When beanies reads a school notice or invite, it now pulls the prep details - what to bring, what to wear, RSVPs - into the activity's notes, so the whole family is ready.",
          beanie:
            "when beanies reads a school notice or invite, it now pulls the prep details - what to bring, what to wear, rsvps - into the activity's notes, so the whole family is ready.",
        },
      },
      {
        title: { en: 'Smarter categories', beanie: 'smarter categories' },
        description: {
          en: 'beanies now picks the right category from your list, so a school learning journey lands as a field trip instead of uncategorized.',
          beanie:
            'beanies now picks the right category from your list, so a school learning journey lands as a field trip instead of uncategorized.',
        },
      },
      {
        title: { en: 'No more duplicates', beanie: 'no more duplicates' },
        description: {
          en: 'Scan the same invite twice and beanies offers to update the activity you already have, instead of quietly adding a duplicate.',
          beanie:
            'scan the same invite twice and beanies offers to update the activity you already have, instead of quietly adding a duplicate.',
        },
      },
    ],
  },
  {
    version: '2026.06.07',
    date: '2026-06-07',
    month: '7 june 2026',
    spotlight: true,
    summary: {
      en: 'New and in beta: let beanies read your invites and bookings for you.',
      beanie: 'new and in beta: let beanies read your invites and bookings for you.',
    },
    features: [
      {
        icon: '✨',
        title: {
          en: 'Magic beans: beanies reads your invites and bookings (beta)',
          beanie: 'magic beans: beanies reads your invites and bookings (beta)',
        },
        description: {
          en: "Snap a photo or PDF of a party invite or a travel booking, and beanies pulls out the details and builds the entire trip or activity for you. Add multiple documents, images, or itineraries to add to an existing trip or create new ones - it's all under your control. Nothing is ever sent without you choosing first, and you can read exactly how your data is kept secure.",
          beanie:
            "snap a photo or pdf of a party invite or a travel booking, and beanies pulls out the details and builds the entire trip or activity for you. add multiple documents, images, or itineraries to add to an existing trip or create new ones - it's all under your control. nothing is ever sent without you choosing first, and you can read exactly how your data is kept secure.",
        },
        descriptionLink: {
          phrase: {
            en: 'you can read exactly how your data is kept secure',
            beanie: 'you can read exactly how your data is kept secure',
          },
          href: 'https://beanies.family/help/security/how-beanies-ai-handles-your-photos',
        },
        cta: {
          label: {
            en: 'Learn more about magic beans',
            beanie: 'learn more about magic beans',
          },
          href: 'https://beanies.family/help/security/how-beanies-ai-handles-your-photos',
        },
      },
    ],
  },
];
