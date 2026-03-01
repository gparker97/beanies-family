import type { UIStringKey } from '@/services/translation/uiStrings';

export type NavSection = 'treehouse' | 'piggyBank' | 'pinned';

export interface NavSectionDef {
  id: NavSection;
  labelKey: UIStringKey;
  emoji: string;
}

export interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  section: NavSection;
  comingSoon?: boolean;
  badgeKey?: string;
}

export const NAV_SECTIONS: NavSectionDef[] = [
  { id: 'treehouse', labelKey: 'nav.section.treehouse', emoji: '\u{1F333}' },
  { id: 'piggyBank', labelKey: 'nav.section.piggyBank', emoji: '\u{1F437}' },
];

export const NAV_ITEMS: NavItemDef[] = [
  // The Treehouse
  {
    labelKey: 'nav.nook',
    path: '/nook',
    emoji: '\u{1F3E1}',
    section: 'treehouse',
  },
  {
    labelKey: 'nav.planner',
    path: '/planner',
    emoji: '\u{1F4C5}',
    section: 'treehouse',
  },
  { labelKey: 'nav.todo', path: '/todo', emoji: '\u2705', section: 'treehouse' },
  {
    labelKey: 'nav.family',
    path: '/family',
    emoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
    section: 'treehouse',
  },
  // The Piggy Bank
  { labelKey: 'nav.overview', path: '/dashboard', emoji: '\u{1F3E0}', section: 'piggyBank' },
  { labelKey: 'nav.accounts', path: '/accounts', emoji: '\u{1F4B0}', section: 'piggyBank' },
  {
    labelKey: 'nav.budgets',
    path: '/budgets',
    emoji: '\u{1F4B5}',
    section: 'piggyBank',
  },
  { labelKey: 'nav.transactions', path: '/transactions', emoji: '\u{1F4B3}', section: 'piggyBank' },
  {
    labelKey: 'nav.goals',
    path: '/goals',
    emoji: '\u{1F3AF}',
    section: 'piggyBank',
    badgeKey: 'activeGoals',
  },
  { labelKey: 'nav.assets', path: '/assets', emoji: '\u{1F3E2}', section: 'piggyBank' },
  // Pinned
  { labelKey: 'nav.settings', path: '/settings', emoji: '\u2699\uFE0F', section: 'pinned' },
];

export const TREEHOUSE_ITEMS = NAV_ITEMS.filter((item) => item.section === 'treehouse');
export const PIGGY_BANK_ITEMS = NAV_ITEMS.filter((item) => item.section === 'piggyBank');
export const PINNED_ITEMS = NAV_ITEMS.filter((item) => item.section === 'pinned');

export interface MobileTabDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
}

export const MOBILE_TAB_ITEMS: MobileTabDef[] = [
  { labelKey: 'mobile.nook', path: '/nook', emoji: '\u{1F3E1}' },
  { labelKey: 'nav.accounts', path: '/accounts', emoji: '\u{1F4B0}' },
  { labelKey: 'nav.goals', path: '/goals', emoji: '\u{1F3AF}' },
  { labelKey: 'mobile.pod', path: '/family', emoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' },
];
