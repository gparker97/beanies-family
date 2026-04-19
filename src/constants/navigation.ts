import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';

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
  external?: boolean;
  externalUrl?: string;
  /**
   * Optional nested sub-items. When present, the parent renders as an
   * expandable group in the sidebar — clicking the parent navigates to its
   * own `path` and reveals the children. Children are rendered via
   * AppSidebarSubNav at an indented scale.
   */
  children?: NavSubItemDef[];
}

export interface NavSubItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
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
    labelKey: 'nav.activities',
    path: '/activities',
    emoji: '\u{1F4C5}',
    section: 'treehouse',
  },
  {
    labelKey: 'nav.travel',
    path: '/travel',
    emoji: '\u2708\uFE0F',
    section: 'treehouse',
  },
  { labelKey: 'nav.todo', path: '/todo', emoji: '\u2705', section: 'treehouse' },
  {
    labelKey: 'nav.pod',
    path: '/pod',
    emoji: '\u{1F331}',
    section: 'treehouse',
    children: [
      {
        labelKey: 'nav.pod.meetBeans',
        path: '/pod',
        emoji: '\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}',
      },
      { labelKey: 'nav.pod.scrapbook', path: '/pod/scrapbook', emoji: '\u{1F4D6}' },
      { labelKey: 'nav.pod.cookbook', path: '/pod/cookbook', emoji: '\u{1F35C}' },
      { labelKey: 'nav.pod.safety', path: '/pod/safety', emoji: '\u{1FA7A}' },
      { labelKey: 'nav.pod.contacts', path: '/pod/contacts', emoji: '\u{1F198}' },
    ],
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
  {
    labelKey: 'nav.help',
    path: '/help',
    emoji: '\u{1F4DA}',
    section: 'pinned',
    external: true,
    externalUrl: `${MARKETING_URL}/help`,
  },
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
  { labelKey: 'mobile.todo', path: '/todo', emoji: '\u2705' },
  { labelKey: 'mobile.activities', path: '/activities', emoji: '\u{1F4C5}' },
  { labelKey: 'mobile.travel', path: '/travel', emoji: '\u2708\uFE0F' },
  { labelKey: 'mobile.piggyBank', path: '/dashboard', emoji: '\u{1F437}' },
  { labelKey: 'mobile.pod', path: '/pod', emoji: '\u{1F331}' },
];
