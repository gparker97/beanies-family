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

// ── Resolver: tip id → BeanTip ────────────────────────────────────────────────
// Single module-level Map (rebuilt from ALL_TIPS on HMR — fully derived, no
// stale-cache concern). Consumed by the notification deriver (via the snapshot)
// and `useNotificationPresentation` (via `getTip`). No ad-hoc `ALL_TIPS.find()`
// allowed elsewhere — this is the single resolver point.

// Note: TIPS_BY_ID is initialised at the bottom of the file, after ALL_TIPS.

// ── Tips ─────────────────────────────────────────────────────────────────────

export const ALL_TIPS: BeanTip[] = [
  {
    id: 'tip-link-txn',
    category: 'finance',
    tryItRoute: '/transactions',
    condition: (ctx) => ctx.transactionCount > 0 && ctx.activityCount > 0,
    message: {
      en: "you can link transactions directly to activities. that way, when you open piano lessons, you'll see exactly what you've paid. no detective work required.",
      beanie:
        "you can link transactions directly to activities. that way, when you open piano lessons, you'll see exactly what you've paid. no detective work required.",
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
      en: 'planning a trip? the vacation planner breaks it into flights, hotels, and activities, and totals the cost so there are no surprises.',
      beanie:
        'planning a trip? the vacation planner breaks it into flights, hotels, and activities, and totals the cost so there are no surprises.',
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
      en: "beanies works offline. if you lose internet, keep going. your data syncs when you're back.",
      beanie:
        "beanies works offline. if you lose internet, keep going. your data syncs when you're back.",
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
    id: 'tip-large-text',
    category: 'general',
    tryItRoute: '/settings',
    message: {
      en: 'text feels small on your phone? settings → appearance → text size has a large mode. the whole app gets bigger and friendlier. buttons, cards, everything.',
      beanie:
        'text feels small on your phone? settings → appearance → text size has a large mode. the whole app gets bigger and friendlier. buttons, cards, everything.',
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
      en: "your data is always yours. export your .beanpod file anytime from settings. it's your encrypted backup.",
      beanie:
        "your data is always yours. export your .beanpod file anytime from settings. it's your encrypted backup.",
    },
  },
  {
    id: 'tip-budget',
    category: 'finance',
    tryItRoute: '/budgets',
    message: {
      en: "set a monthly budget and beanies will show you how you're tracking. green means good. orange means... well.",
      beanie:
        "set a monthly budget and beanies will show you how you're tracking. green means good. orange means... well.",
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
    // /pod is the family-pod hub (Meet the Beans). The "add milestone" flow
    // is bean-scoped — user picks a member, then ＋ Add → 🌟 Milestone — so we
    // route to the hub rather than /pod/milestones (the family-wide view).
    tryItRoute: '/pod',
    message: {
      en: "track your family's milestones. first day of school, lost teeth, birthdays. the small stuff matters. that's what beanies is for.",
      beanie:
        "track your family's milestones. first day of school, lost teeth, birthdays. the small stuff matters. that's what beanies is for.",
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
    tryItRoute: '/nook',
    message: {
      en: "the nook shows today's schedule and the week ahead, only the stuff assigned to you. one glance to know where you need to be.",
      beanie:
        "the nook shows today's schedule and the week ahead, only the stuff assigned to you. one glance to know where you need to be.",
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
      en: "the dashboard tracks your net worth over time. it adds up everything (accounts, assets, loans) so you don't have to.",
      beanie:
        "the dashboard tracks your net worth over time. it adds up everything (accounts, assets, loans) so you don't have to.",
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
      en: 'beanies speaks Chinese too. switch languages in settings. all labels, tips, and help content translate.',
      beanie:
        'beanies speaks Chinese too. switch languages in settings. all labels, tips, and help content translate.',
    },
  },

  // ── New features (2026-06) ──────────────────────────────────────────────────
  {
    id: 'tip-magic-invite',
    category: 'planner',
    tryItRoute: '/activities',
    message: {
      en: 'snap a photo of a party invite or school notice and let magic beans read it. the date, time, place, and what to bring fill themselves in.',
      beanie:
        'snap a photo of a party invite or school notice and let magic beans read it. the date, time, place, and what to bring fill themselves in.',
    },
  },
  {
    id: 'tip-magic-travel',
    category: 'planner',
    tryItRoute: '/travel',
    message: {
      en: 'got a flight or hotel confirmation? hand it to magic beans on the travel page and beanies builds the trip for you, flights and all.',
      beanie:
        'got a flight or hotel confirmation? hand it to magic beans on the travel page and beanies builds the trip for you, flights and all.',
    },
  },
  {
    id: 'tip-magic-camera',
    category: 'planner',
    tryItRoute: '/activities',
    message: {
      en: "on your phone you don't even need to save the photo first. tap magic beans, point your camera at the notice, and you're done.",
      beanie:
        "on your phone you don't even need to save the photo first. tap magic beans, point your camera at the notice, and you're done.",
    },
  },
  {
    id: 'tip-magic-dupe',
    category: 'planner',
    tryItRoute: '/activities',
    message: {
      en: 'scanned the same invite twice? beanies spots it and offers to update what you already have, so you never end up with two.',
      beanie:
        'scanned the same invite twice? beanies spots it and offers to update what you already have, so you never end up with two.',
    },
  },
  {
    id: 'tip-magic-prep',
    category: 'planner',
    tryItRoute: '/activities',
    message: {
      en: "field trip coming up? when beanies reads the notice, the 'bring a backpack, snack, water bottle' bits land right in the activity notes.",
      beanie:
        "field trip coming up? when beanies reads the notice, the 'bring a backpack, snack, water bottle' bits land right in the activity notes.",
    },
  },
  {
    id: 'tip-ai-privacy',
    category: 'security',
    message: {
      en: "feeding documents to ai feels scary, i get it. beanies reads them inside sealed, private hardware we can't see into, keeps nothing, and trains nothing.",
      beanie:
        "feeding documents to ai feels scary, i get it. beanies reads them inside sealed, private hardware we can't see into, keeps nothing, and trains nothing.",
    },
  },
  {
    id: 'tip-activity-photos',
    category: 'planner',
    tryItRoute: '/activities',
    message: {
      en: "pin a photo to any activity. the invite, a map to the venue, the kit list, whatever you'll want later. it lives right on the calendar entry.",
      beanie:
        "pin a photo to any activity. the invite, a map to the venue, the kit list, whatever you'll want later. it lives right on the calendar entry.",
    },
  },
  {
    id: 'tip-scrapbook',
    category: 'family',
    tryItRoute: '/pod/scrapbook',
    message: {
      en: "the family scrapbook is for the everyday photos, not just the big occasions. that's usually the stuff you're glad you kept.",
      beanie:
        "the family scrapbook is for the everyday photos, not just the big occasions. that's usually the stuff you're glad you kept.",
    },
  },
  {
    id: 'tip-travel-docs',
    category: 'planner',
    tryItRoute: '/travel',
    message: {
      en: "keep boarding passes and hotel confirmations attached to the trip itself, so they're one tap away when you're standing at the gate.",
      beanie:
        "keep boarding passes and hotel confirmations attached to the trip itself, so they're one tap away when you're standing at the gate.",
    },
  },
  {
    id: 'tip-milestone-photo',
    category: 'family',
    tryItRoute: '/pod/milestones',
    message: {
      en: 'add a photo to a milestone and the first lost tooth becomes a memory, not just a date in a list.',
      beanie:
        'add a photo to a milestone and the first lost tooth becomes a memory, not just a date in a list.',
    },
  },
  {
    id: 'tip-cookbook',
    category: 'family',
    tryItRoute: '/pod/cookbook',
    message: {
      en: "the family cookbook keeps grandma's recipes and the weeknight regulars together. no more digging through screenshots.",
      beanie:
        "the family cookbook keeps grandma's recipes and the weeknight regulars together. no more digging through screenshots.",
    },
  },
  {
    id: 'tip-medications',
    category: 'family',
    tryItRoute: '/pod',
    message: {
      en: "keep each bean's medications on their page, with the dose and timing. a lifesaver for a babysitter, or a 2am 'wait, how much?'",
      beanie:
        "keep each bean's medications on their page, with the dose and timing. a lifesaver for a babysitter, or a 2am 'wait, how much?'",
    },
  },
  {
    id: 'tip-allergies',
    category: 'family',
    tryItRoute: '/pod/safety',
    message: {
      en: 'log allergies on the care & safety page so anyone minding the kids knows what to avoid at a glance.',
      beanie:
        'log allergies on the care & safety page so anyone minding the kids knows what to avoid at a glance.',
    },
  },
  {
    id: 'tip-contacts',
    category: 'family',
    tryItRoute: '/pod/contacts',
    message: {
      en: 'fill in your emergency contacts once. the doctor, the school, the neighbour with the spare key, all there when you need them in a hurry.',
      beanie:
        'fill in your emergency contacts once. the doctor, the school, the neighbour with the spare key, all there when you need them in a hurry.',
    },
  },
  {
    id: 'tip-care-safety',
    category: 'family',
    tryItRoute: '/pod/safety',
    message: {
      en: 'the care & safety page gathers allergies, medications, and who to call in one spot, so a sitter has what they need without asking.',
      beanie:
        'the care & safety page gathers allergies, medications, and who to call in one spot, so a sitter has what they need without asking.',
    },
  },
  {
    id: 'tip-sayings',
    category: 'family',
    tryItRoute: '/pod',
    message: {
      en: "kids say the funniest things. jot them down under a bean's sayings before you forget. future you will thank you.",
      beanie:
        "kids say the funniest things. jot them down under a bean's sayings before you forget. future you will thank you.",
    },
  },
  {
    id: 'tip-invite-partner',
    category: 'family',
    tryItRoute: '/family',
    message: {
      en: "beanies is better shared. invite your partner from the family page and you'll both see the same plan, always in sync.",
      beanie:
        "beanies is better shared. invite your partner from the family page and you'll both see the same plan, always in sync.",
    },
  },
  {
    id: 'tip-assets',
    category: 'finance',
    tryItRoute: '/assets',
    message: {
      en: 'car, house, a bit of crypto? add them as assets and beanies folds them into your net worth without you doing the math.',
      beanie:
        'car, house, a bit of crypto? add them as assets and beanies folds them into your net worth without you doing the math.',
    },
  },
];

// ── Resolver implementation (declared at bottom so ALL_TIPS exists) ──────────

export const TIPS_BY_ID: ReadonlyMap<string, BeanTip> = new Map(
  ALL_TIPS.map((tip) => [tip.id, tip])
);

/** Resolve a tip by its `BeanTip.id`. Returns undefined when the tip has been
 *  removed from `ALL_TIPS` since issuance — callers must handle that. */
export function getTip(id: string): BeanTip | undefined {
  return TIPS_BY_ID.get(id);
}
