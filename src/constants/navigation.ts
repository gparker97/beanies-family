import type { UIStringKey } from '@/services/translation/uiStrings';

export interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  section: 'primary' | 'secondary';
}

export const NAV_ITEMS: NavItemDef[] = [
  // Primary navigation
  { labelKey: 'nav.dashboard', path: '/dashboard', emoji: '\u{1F3E0}', section: 'primary' },
  { labelKey: 'nav.accounts', path: '/accounts', emoji: '\u{1F4B0}', section: 'primary' },
  { labelKey: 'nav.transactions', path: '/transactions', emoji: '\u{1F4B3}', section: 'primary' },
  { labelKey: 'nav.assets', path: '/assets', emoji: '\u{1F3E2}', section: 'primary' },
  { labelKey: 'nav.goals', path: '/goals', emoji: '\u{1F3AF}', section: 'primary' },
  { labelKey: 'nav.reports', path: '/reports', emoji: '\u{1F4CA}', section: 'primary' },
  { labelKey: 'nav.forecast', path: '/forecast', emoji: '\u{1F4C8}', section: 'primary' },
  // Secondary navigation
  {
    labelKey: 'nav.family',
    path: '/family',
    emoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
    section: 'secondary',
  },
  { labelKey: 'nav.settings', path: '/settings', emoji: '\u2699\uFE0F', section: 'secondary' },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.section === 'primary');
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.section === 'secondary');

export interface MobileTabDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
}

export const MOBILE_TAB_ITEMS: MobileTabDef[] = [
  { labelKey: 'mobile.nook', path: '/dashboard', emoji: '\u{1F3E0}' },
  { labelKey: 'nav.accounts', path: '/accounts', emoji: '\u{1F4B0}' },
  { labelKey: 'nav.goals', path: '/goals', emoji: '\u{1F3AF}' },
  { labelKey: 'mobile.pod', path: '/family', emoji: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}' },
];
