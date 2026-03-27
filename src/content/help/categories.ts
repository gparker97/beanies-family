import type { HelpCategoryMeta } from './types';

export const HELP_CATEGORIES: HelpCategoryMeta[] = [
  {
    id: 'whats-new',
    labelKey: 'help.category.whatsNew',
    descriptionKey: 'help.category.whatsNewDesc',
    icon: '\u{1F331}',
    color: 'primary',
  },
  {
    id: 'getting-started',
    labelKey: 'help.category.gettingStarted',
    descriptionKey: 'help.category.gettingStartedDesc',
    icon: '\u{1F680}',
    color: 'primary',
  },
  {
    id: 'features',
    labelKey: 'help.category.features',
    descriptionKey: 'help.category.featuresDesc',
    icon: '\u2728',
    color: 'terracotta',
  },
  {
    id: 'security',
    labelKey: 'help.category.security',
    descriptionKey: 'help.category.securityDesc',
    icon: '\u{1F512}',
    color: 'secondary',
  },
  {
    id: 'how-it-works',
    labelKey: 'help.category.howItWorks',
    descriptionKey: 'help.category.howItWorksDesc',
    icon: '\u2699\uFE0F',
    color: 'sky-silk',
  },
];

export function getCategoryMeta(id: string): HelpCategoryMeta | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id);
}
