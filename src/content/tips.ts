/**
 * Beanie Tip of the Day — content definitions.
 *
 * Each tip is shown once, one per day, in order. Tips with a `condition`
 * are skipped if the condition returns false (e.g., user has no activities).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type TipCategory = 'finance' | 'planner' | 'family' | 'security' | 'general';

export interface BeanTip {
  id: string;
  message: { en: string; beanie: string };
  category: TipCategory;
  /** Route for "try it →" pill. Omit for general tips with no destination. */
  tryItRoute?: string;
  /** Only show if condition returns true. Receives store counts for simplicity. */
  condition?: (ctx: TipContext) => boolean;
}

/** Minimal context passed to tip conditions — avoids importing stores in content. */
export interface TipContext {
  transactionCount: number;
  activityCount: number;
  todoCount: number;
  goalCount: number;
  vacationCount: number;
  memberCount: number;
  accountCount: number;
}

// ── Category → beanie character image ────────────────────────────────────────

const CATEGORY_IMAGES: Record<TipCategory, string> = {
  finance: '/brand/beanies_father_son_icon_192x192.png',
  family: '/brand/beanies_family_hugging_transparent_192x192.png',
  security: '/brand/beanies_covering_eyes_transparent_512x512.png',
  planner: '/brand/beanies_celebrating_circle_transparent_300x300.png',
  general: '/brand/beanies_logo_transparent_logo_only_192x192.png',
};

export function getCategoryImage(category: TipCategory): string {
  return CATEGORY_IMAGES[category];
}

// ── Tips ─────────────────────────────────────────────────────────────────────

export const ALL_TIPS: BeanTip[] = [
  {
    id: 'tip-link-txn',
    category: 'finance',
    tryItRoute: '/transactions',
    condition: (ctx) => ctx.transactionCount > 0 && ctx.activityCount > 0,
    message: {
      en: "you can link transactions directly to activities. that way, when you open piano lessons, you'll see exactly what you've paid — no detective work required.",
      beanie:
        "you can link transactions directly to activities. that way, when you open piano lessons, you'll see exactly what you've paid — no detective work required.",
    },
  },
  {
    id: 'tip-recurring',
    category: 'finance',
    tryItRoute: '/transactions',
    message: {
      en: "set up recurring transactions once and forget about them. beanies will project them forward so you can see what's coming before it hits.",
      beanie:
        "set up recurring transactions once and forget about them. beanies will project them forward so you can see what's coming before it hits.",
    },
  },
  {
    id: 'tip-vacation',
    category: 'planner',
    tryItRoute: '/travel',
    message: {
      en: 'planning a trip? the vacation planner breaks it into flights, hotels, and activities — and totals the cost so there are no surprises.',
      beanie:
        'planning a trip? the vacation planner breaks it into flights, hotels, and activities — and totals the cost so there are no surprises.',
    },
  },
  {
    id: 'tip-passkey',
    category: 'security',
    tryItRoute: '/settings',
    message: {
      en: "skip the password next time. set up a passkey in settings and sign in with your fingerprint or face. it's faster and more secure.",
      beanie:
        "skip the password next time. set up a passkey in settings and sign in with your fingerprint or face. it's faster and more secure.",
    },
  },
  {
    id: 'tip-member-roles',
    category: 'family',
    tryItRoute: '/family',
    condition: (ctx) => ctx.memberCount > 1,
    message: {
      en: "not all beans need to see the money stuff. set your kids as little beans and they'll only see their activities and to-dos.",
      beanie:
        "not all beans need to see the money stuff. set your kids as little beans and they'll only see their activities and to-dos.",
    },
  },
  {
    id: 'tip-offline',
    category: 'general',
    message: {
      en: "beanies works offline. if you lose internet, keep going — your data syncs when you're back.",
      beanie:
        "beanies works offline. if you lose internet, keep going — your data syncs when you're back.",
    },
  },
  {
    id: 'tip-dark-mode',
    category: 'general',
    tryItRoute: '/settings',
    message: {
      en: 'night owl? dark mode is in settings. your eyes (and your phone battery) will thank you.',
      beanie:
        'night owl? dark mode is in settings. your eyes (and your phone battery) will thank you.',
    },
  },
  {
    id: 'tip-fee-schedule',
    category: 'planner',
    tryItRoute: '/activities',
    condition: (ctx) => ctx.activityCount > 0,
    message: {
      en: "activities with fees? choose 'each' to pay per session, or 'all' to pay once upfront. beanies tracks either way.",
      beanie:
        "activities with fees? choose 'each' to pay per session, or 'all' to pay once upfront. beanies tracks either way.",
    },
  },
  {
    id: 'tip-export',
    category: 'security',
    tryItRoute: '/settings',
    message: {
      en: "your data is always yours. export your .beanpod file anytime from settings — it's your encrypted backup.",
      beanie:
        "your data is always yours. export your .beanpod file anytime from settings — it's your encrypted backup.",
    },
  },
  {
    id: 'tip-budget',
    category: 'finance',
    tryItRoute: '/dashboard',
    message: {
      en: "set a monthly budget on the dashboard and beanies will show you how you're tracking. green means good. orange means... well.",
      beanie:
        "set a monthly budget on the dashboard and beanies will show you how you're tracking. green means good. orange means... well.",
    },
  },
  {
    id: 'tip-filter-txn',
    category: 'finance',
    tryItRoute: '/dashboard',
    condition: (ctx) => ctx.transactionCount > 0,
    message: {
      en: 'tap the income or expense cards on your dashboard to jump straight to a filtered transaction list. less scrolling.',
      beanie:
        'tap the income or expense cards on your dashboard to jump straight to a filtered transaction list. less scrolling.',
    },
  },
  {
    id: 'tip-milestones',
    category: 'family',
    tryItRoute: '/goals',
    message: {
      en: "track your family's milestones — first day of school, lost teeth, birthdays. the small stuff matters. that's what beanies is for.",
      beanie:
        "track your family's milestones — first day of school, lost teeth, birthdays. the small stuff matters. that's what beanies is for.",
    },
  },
  {
    id: 'tip-multi-currency',
    category: 'finance',
    tryItRoute: '/settings',
    message: {
      en: 'dealing with multiple currencies? beanies converts everything to your base currency automatically. set your rates in settings.',
      beanie:
        'dealing with multiple currencies? beanies converts everything to your base currency automatically. set your rates in settings.',
    },
  },
  {
    id: 'tip-goal-tracking',
    category: 'finance',
    tryItRoute: '/goals',
    message: {
      en: "set savings goals and watch the progress bar fill up. it's weirdly motivating. trust me.",
      beanie:
        "set savings goals and watch the progress bar fill up. it's weirdly motivating. trust me.",
    },
  },
  {
    id: 'tip-trust-device',
    category: 'security',
    tryItRoute: '/settings',
    message: {
      en: 'trust this device in settings to skip the password on your everyday devices. still encrypted, just faster.',
      beanie:
        'trust this device in settings to skip the password on your everyday devices. still encrypted, just faster.',
    },
  },
  {
    id: 'tip-nook-schedule',
    category: 'general',
    message: {
      en: "the nook shows today's schedule and the week ahead — only the stuff assigned to you. one glance to know where you need to be.",
      beanie:
        "the nook shows today's schedule and the week ahead — only the stuff assigned to you. one glance to know where you need to be.",
    },
  },
  {
    id: 'tip-todo',
    category: 'planner',
    tryItRoute: '/todo',
    message: {
      en: 'family to-dos keep everyone on the same page. assign tasks to specific beans and check them off together.',
      beanie:
        'family to-dos keep everyone on the same page. assign tasks to specific beans and check them off together.',
    },
  },
  {
    id: 'tip-net-worth',
    category: 'finance',
    tryItRoute: '/dashboard',
    condition: (ctx) => ctx.accountCount > 0,
    message: {
      en: "the dashboard tracks your net worth over time. it adds up everything — accounts, assets, loans — so you don't have to.",
      beanie:
        "the dashboard tracks your net worth over time. it adds up everything — accounts, assets, loans — so you don't have to.",
    },
  },
  {
    id: 'tip-beanie-mode',
    category: 'general',
    tryItRoute: '/settings',
    message: {
      en: 'toggle beanie mode in settings for a more casual vibe. all the labels get a little sillier. because why not.',
      beanie:
        'toggle beanie mode in settings for a more casual vibe. all the labels get a little sillier. because why not.',
    },
  },
  {
    id: 'tip-chinese',
    category: 'general',
    tryItRoute: '/settings',
    message: {
      en: 'beanies speaks Chinese too. switch languages in settings — all labels, tips, and help content translate.',
      beanie:
        'beanies speaks Chinese too. switch languages in settings — all labels, tips, and help content translate.',
    },
  },
];
