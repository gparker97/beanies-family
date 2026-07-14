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
    version: '2026.07.14',
    date: '2026-07-14',
    month: '14 july 2026',
    summary: {
      en: 'Behind-the-scenes improvements to biometric sign-in, and polish for the app.',
      beanie: 'behind-the-scenes improvements to biometric sign-in, and polish for the app.',
    },
  },
  {
    version: '2026.07.13',
    date: '2026-07-13',
    month: '13 july 2026',
    summary: {
      en: "Reliability improvements so your family's data loads and saves more dependably.",
      beanie: "reliability improvements so your family's data loads and saves more dependably.",
    },
  },
  {
    version: '2026.07.09',
    date: '2026-07-09',
    month: '9 july 2026',
    summary: {
      en: 'You can now tell me what you think right inside the app - a quick score and a few words, in about ten seconds.',
      beanie:
        'you can now tell me what you think right inside the app - a quick score and a few words, in about ten seconds.',
    },
    features: [
      {
        icon: '📣',
        title: { en: 'Share your feedback', beanie: 'share your feedback' },
        description: {
          en: "Open the menu and tap Share feedback: rate how likely you'd recommend beanies.family and add a few words, in about ten seconds. Stay anonymous or leave your details if you'd like a reply, and you can switch off the occasional prompt any time in Settings.",
          beanie:
            "open the menu and tap share feedback: rate how likely you'd recommend beanies.family and add a few words, in about ten seconds. stay anonymous or leave your details if you'd like a reply, and you can switch off the occasional prompt any time in settings.",
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.07.08',
    date: '2026-07-08',
    month: '8 july 2026',
    spotlight: true,
    summary: {
      en: 'You can now move money between your accounts and pay down credit cards, so your account balances stay correct. Thanks to my early-adopter beanie whose feedback on Discord made this happen!',
      beanie:
        'you can now move money between your accounts and pay down credit cards, so your account balances stay correct. thanks to my early-adopter beanie whose feedback on discord made this happen!',
    },
    features: [
      {
        icon: '🔄',
        title: {
          en: 'Transfers and credit-card payments',
          beanie: 'transfers and credit-card payments',
        },
        description: {
          en: "Add a transaction, pick Transfer, and choose where the money leaves and where it lands. Both balances update at once. Paying a credit card is simply a transfer to the card, and transfers between different currencies convert automatically. This one came straight from an early-adopter beanie's feedback on Discord.",
          beanie:
            "add a transaction, pick transfer, and choose where the money leaves and where it lands. both balances update at once. paying a credit card is simply a transfer to the card, and transfers between different currencies convert automatically. this one came straight from an early-adopter beanie's feedback on discord.",
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not). Your feedback shapes what we build next, just like this update.",
          beanie:
            "get the latest beanies news and tell us what's working (or not). your feedback shapes what we build next, just like this update.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.07.07',
    date: '2026-07-07',
    month: '7 july 2026',
    spotlight: true,
    summary: {
      en: "Improved data handling under the hood, and the app no longer feels frozen when you open it after you've been away.",
      beanie:
        "improved data handling under the hood, and the app no longer feels frozen when you open it after you've been away.",
    },
    features: [
      {
        icon: '⚡',
        title: {
          en: 'Smoother loading, no more freeze',
          beanie: 'smoother loading, no more freeze',
        },
        description: {
          en: "Loading and syncing your family's data now happens in the background, so the app stays responsive even when there's a lot to catch up on, like when you haven't opened it in a while. We also improved how your data is saved and synced, so your most recent change is safer and updates do less work.",
          beanie:
            "loading and syncing your family's data now happens in the background, so the app stays responsive even when there's a lot to catch up on, like when you haven't opened it in a while. we also improved how your data is saved and synced, so your most recent change is safer and updates do less work.",
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.07.06',
    date: '2026-07-06',
    month: '6 july 2026',
    summary: {
      en: 'Minor bug fixes and improvements.',
      beanie: 'minor bug fixes and improvements.',
    },
  },
  {
    version: '2026.07.03',
    date: '2026-07-03',
    month: '3 july 2026',
    spotlight: true,
    summary: {
      en: 'Google Calendar sync is now official, plus a clearer privacy promise as you set up.',
      beanie: 'google calendar sync is now official, plus a clearer privacy promise as you set up.',
    },
    features: [
      {
        icon: '📅',
        title: {
          en: 'Google Calendar sync is official',
          beanie: 'google calendar sync is official',
        },
        description: {
          en: "Syncing your family's activities to your Google Calendar is now a proper feature with its own card in Settings, no experimental toggle needed. Connect a calendar, choose where events go, and beanies keeps it in sync. Google's review is done, so anyone can turn it on.",
          beanie:
            "syncing your family's activities to your google calendar is now a proper feature with its own card in settings, no experimental toggle needed. connect a calendar, choose where events go, and beanies keeps it in sync. google's review is done, so anyone can turn it on.",
        },
      },
      {
        icon: '🔒',
        title: { en: 'Your data stays with you', beanie: 'your data stays with you' },
        description: {
          en: 'When you add your first account, beanies now spells out the privacy promise with a quick "How?" note: your data lives in a file only you hold, it stays locked to your key even in the cloud, and we can\'t read it. Ever.',
          beanie:
            'when you add your first account, beanies now spells out the privacy promise with a quick "how?" note: your data lives in a file only you hold, it stays locked to your key even in the cloud, and we can\'t read it. ever.',
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.07.02',
    date: '2026-07-02',
    month: '2 july 2026',
    summary: {
      en: 'Minor bug fixes and improvements.',
      beanie: 'minor bug fixes and improvements.',
    },
  },
  {
    version: '2026.07.01',
    date: '2026-07-01',
    month: '1 july 2026',
    spotlight: true,
    summary: {
      en: 'Scanning a PDF invite or itinerary now reads past the first page.',
      beanie: 'scanning a pdf invite or itinerary now reads past the first page.',
    },
    features: [
      {
        icon: '📄',
        title: { en: 'Multi-page PDFs', beanie: 'multi-page pdfs' },
        description: {
          en: "When you scan a PDF invitation or travel itinerary with magic beans, beanies now reads its first several pages instead of just page one - so a return flight, a second day's schedule, or the RSVP on the back gets picked up too. The full document is still saved alongside whatever it creates.",
          beanie:
            "when you scan a pdf invitation or travel itinerary with magic beans, beanies now reads its first several pages instead of just page one - so a return flight, a second day's schedule, or the rsvp on the back gets picked up too. the full document is still saved alongside whatever it creates.",
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.06.28',
    date: '2026-06-28',
    month: '28 june 2026',
    summary: {
      en: 'Minor bug fixes and improvements.',
      beanie: 'minor bug fixes and improvements.',
    },
  },
  {
    version: '2026.06.26',
    date: '2026-06-26',
    month: '26 june 2026',
    summary: {
      en: 'Setting up a new family is simpler now - one password, and add your family right in setup.',
      beanie:
        'setting up a new family is simpler now - one password, and add your family right in setup.',
    },
  },
  {
    version: '2026.06.20',
    date: '2026-06-20',
    month: '20 june 2026',
    summary: {
      en: 'Creating or joining a family on iPhone now works smoothly - no more getting stuck partway through Google sign-in.',
      beanie:
        'creating or joining a family on iphone now works smoothly - no more getting stuck partway through google sign-in.',
    },
  },
  {
    version: '2026.06.19',
    date: '2026-06-19',
    month: '19 june 2026',
    summary: {
      en: 'Smoother sign-up, especially on iPhone.',
      beanie: 'smoother sign-up, especially on iphone.',
    },
    features: [
      {
        title: { en: 'A more reliable sign-up', beanie: 'a more reliable sign-up' },
        description: {
          en: "Setting up your family is now more dependable. If a first attempt gets interrupted, beanies picks up where it left off instead of getting stuck, and it's clearer when Google needs permission to save your family file. Mostly felt on iPhone.",
          beanie:
            "setting up your family is now more dependable. if a first attempt gets interrupted, beanies picks up where it left off instead of getting stuck, and it's clearer when google needs permission to save your family file. mostly felt on iphone.",
        },
      },
    ],
  },
  {
    version: '2026.06.18.2',
    date: '2026-06-18',
    month: '18 june 2026',
    spotlight: true,
    summary: {
      en: 'Introducing - Beanie Lists!',
      beanie: 'introducing - beanie lists!',
    },
    features: [
      {
        icon: '🧾',
        title: { en: 'Beanie Lists', beanie: 'beanie lists' },
        description: {
          en: 'Shared checklists for the little things that make up life - groceries, before school, packing, chores, and more. Set a list with a due date, or assign a repeating list to yourself or your partner that automatically resets itself each cycle. Sort by category, assign an owner, and link lists directly to your travel plans or activities.',
          beanie:
            'shared checklists for the little things that make up life - groceries, before school, packing, chores, and more. set a list with a due date, or assign a repeating list to yourself or your partner that automatically resets itself each cycle. sort by category, assign an owner, and link lists directly to your travel plans or activities.',
        },
        tryItRoute: '/lists',
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.06.18',
    date: '2026-06-18',
    month: '18 june 2026',
    summary: {
      en: 'The Travel Plans badge now flags what still needs booking.',
      beanie: 'the travel plans badge now flags what still needs booking.',
    },
  },
  {
    version: '2026.06.15',
    date: '2026-06-15',
    month: '15 june 2026',
    spotlight: true,
    summary: {
      en: 'A smoother, more reliable setup - and a more fully translated app.',
      beanie: 'a smoother, more reliable setup - and a more fully translated app.',
    },
    features: [
      {
        title: { en: 'Smoother sign-up and joining', beanie: 'smoother sign-up and joining' },
        description: {
          en: 'Creating a family - or joining one by invite - is more reliable now, with fixes for a sign-up screen that could get stuck, especially on iPhone and Safari.',
          beanie:
            'creating a family - or joining one by invite - is more reliable now, with fixes for a sign-up screen that could get stuck, especially on iphone and safari.',
        },
      },
      {
        title: { en: 'Fuller Chinese translation', beanie: 'fuller chinese translation' },
        description: {
          en: 'If you use beanies in Chinese, the whole app is now translated - we cleaned up screens that were still showing English or garbled text.',
          beanie:
            'if you use beanies in chinese, the whole app is now translated - we cleaned up screens that were still showing english or garbled text.',
        },
      },
      {
        icon: '💬',
        title: { en: 'Join us on Discord', beanie: 'join us on discord' },
        description: {
          en: "Get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
          beanie:
            "get the latest beanies news and tell us what's working (or not) - report any issues or share feedback, and help shape what's next.",
        },
        cta: {
          label: { en: 'Join the Discord', beanie: 'join the discord' },
          href: 'https://beanies.family/discord',
        },
      },
    ],
  },
  {
    version: '2026.06.14',
    date: '2026-06-14',
    month: '14 june 2026',
    spotlight: false,
    summary: {
      en: 'Reliability and behind-the-scenes improvements.',
      beanie: 'reliability and behind-the-scenes improvements.',
    },
  },
  {
    version: '2026.06.12.2',
    date: '2026-06-12',
    month: '12 june 2026',
    spotlight: false,
    summary: {
      en: "The connection to your family data file is now more reliable, so you'll be asked to reconnect and sign in far less often.",
      beanie:
        "the connection to your family data file is now more reliable, so you'll be asked to reconnect and sign in far less often.",
    },
  },
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
