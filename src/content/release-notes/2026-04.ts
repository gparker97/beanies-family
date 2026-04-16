import type { ReleaseNote } from './index';

export const RELEASE_2026_04: ReleaseNote = {
  version: '2026.04',
  date: '2026-04-15',
  month: 'april 2026',
  features: [
    {
      title: {
        en: 'daily calendar — one day, all your beans',
        beanie: 'daily calendar — one day, all your beans',
      },
      description: {
        en: 'see everyone\u2019s schedule side-by-side in per-member columns. adults first, then kids, each with their own colour accent. tap an empty slot to pre-fill the date, time, and member in one go.',
        beanie:
          'see everyone\u2019s schedule side-by-side in per-member columns. adults first, then kids, each with their own colour accent. tap an empty slot to pre-fill the date, time, and member in one go.',
      },
      tryItRoute: '/activities',
    },
    {
      title: {
        en: 'day / week / month toggle on the planner',
        beanie: 'day / week / month toggle on the planner',
      },
      description: {
        en: 'zoom in or out without leaving the page. day for today\u2019s logistics, week for the sprint ahead, month for the big picture. the calendar remembers where you last were.',
        beanie:
          'zoom in or out without leaving the page. day for today\u2019s logistics, week for the sprint ahead, month for the big picture. the calendar remembers where you last were.',
      },
      tryItRoute: '/activities',
    },
    {
      title: {
        en: 'budgets play nicely with every currency',
        beanie: 'budgets play nicely with every currency',
      },
      description: {
        en: 'mix SGD, USD, and GBP inside the same budget \u2014 totals now convert cleanly into your display currency, and the progress bars finally tell the truth.',
        beanie:
          'mix SGD, USD, and GBP inside the same budget \u2014 totals now convert cleanly into your display currency, and the progress bars finally tell the truth.',
      },
      tryItRoute: '/transactions',
    },
    {
      title: {
        en: 'privacy & terms pages, in plain english',
        beanie: 'privacy & terms pages, in plain english',
      },
      description: {
        en: 'new /privacy and /terms pages lay out exactly how beanies.family handles your data (spoiler: we never see it), what the open-source license covers, and what we do and don\u2019t promise. linked from the footer on every page.',
        beanie:
          'new /privacy and /terms pages lay out exactly how beanies.family handles your data (spoiler: we never see it), what the open-source license covers, and what we do and don\u2019t promise. linked from the footer on every page.',
      },
      tryItRoute: '/privacy',
    },
    {
      title: {
        en: 'optional substack subscribe during signup',
        beanie: 'optional substack subscribe during signup',
      },
      description: {
        en: 'a pre-checked opt-out box on the create-pod screen signs you up to the beanstalk \u2014 the monthly newsletter with what\u2019s being built, why, and what\u2019s coming next. untick it if you\u2019d rather not.',
        beanie:
          'a pre-checked opt-out box on the create-pod screen signs you up to the beanstalk \u2014 the monthly newsletter with what\u2019s being built, why, and what\u2019s coming next. untick it if you\u2019d rather not.',
      },
    },
    {
      title: {
        en: 'product hunt launch + first 13 real families',
        beanie: 'product hunt launch + first 13 real families',
      },
      description: {
        en: 'beanies.family launched on product hunt during alpha day on april 9, and thirteen real families are now using it day-to-day. thank you for being here early \u2014 your feedback is shaping everything.',
        beanie:
          'beanies.family launched on product hunt during alpha day on april 9, and thirteen real families are now using it day-to-day. thank you for being here early \u2014 your feedback is shaping everything.',
      },
    },
  ],
  fixes: [
    {
      text: {
        en: 'onboarding overlay no longer gets stuck on safari / ios',
        beanie: 'onboarding overlay no longer gets stuck on safari / ios',
      },
    },
    {
      text: {
        en: 'activity drawer fields now flow naturally: title \u2192 schedule \u2192 who \u2192 category',
        beanie:
          'activity drawer fields now flow naturally: title \u2192 schedule \u2192 who \u2192 category',
      },
    },
    {
      text: {
        en: 'calendar + hover shows the time range (e.g. \u201c3pm \u2013 4pm\u201d)',
        beanie: 'calendar + hover shows the time range (e.g. \u201c3pm \u2013 4pm\u201d)',
      },
    },
    {
      text: {
        en: 'all-day activities get an \u201call day\u201d label in list views',
        beanie: 'all-day activities get an \u201call day\u201d label in list views',
      },
    },
    {
      text: {
        en: 'blog moved from /beanstalk to /blog (old links redirect automatically)',
        beanie: 'blog moved from /beanstalk to /blog (old links redirect automatically)',
      },
    },
    {
      text: {
        en: 'setup wizard now shows a progress modal while your first pod is created',
        beanie: 'setup wizard now shows a progress modal while your first pod is created',
      },
    },
  ],
};
