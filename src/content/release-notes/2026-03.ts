import type { ReleaseNote } from './index';

export const RELEASE_2026_03: ReleaseNote = {
  version: '2026.03',
  date: '2026-03-27',
  month: 'march 2026',
  features: [
    {
      title: {
        en: 'pay for activities upfront',
        beanie: 'pay for activities upfront',
      },
      description: {
        en: 'set a single fee that covers all sessions. no more tracking individual payments for piano lessons — one transaction, done.',
        beanie:
          'set a single fee that covers all sessions. no more tracking individual payments for piano lessons — one transaction, done.',
      },
      tryItRoute: '/activities',
    },
    {
      title: {
        en: 'tap to filter transactions',
        beanie: 'tap to filter transactions',
      },
      description: {
        en: 'tap the income or expense card on your dashboard and jump straight to a filtered list. less scrolling, more finding.',
        beanie:
          'tap the income or expense card on your dashboard and jump straight to a filtered list. less scrolling, more finding.',
      },
      tryItRoute: '/dashboard',
    },
    {
      title: {
        en: 'links on travel segments',
        beanie: 'links on travel segments',
      },
      description: {
        en: 'add booking confirmation URLs to flights, hotels, and car rentals. everything in one place when you need it.',
        beanie:
          'add booking confirmation URLs to flights, hotels, and car rentals. everything in one place when you need it.',
      },
      tryItRoute: '/travel',
    },
  ],
  fixes: [
    {
      text: {
        en: 'time picker scrolls to your selection',
        beanie: 'time picker scrolls to your selection',
      },
    },
    {
      text: {
        en: 'all dates now show as "25 mar 2026"',
        beanie: 'all dates now show as "25 mar 2026"',
      },
    },
    { text: { en: '12-hour time format everywhere', beanie: '12-hour time format everywhere' } },
  ],
};
