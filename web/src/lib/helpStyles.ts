/**
 * Shared style maps + English copy for the Astro help center.
 * Mirrors the style tokens + translation strings used by the Vue HelpCenterPage
 * so the Astro pages render pixel-identically.
 */

export const categoryStripe: Record<string, string> = {
  primary: 'bg-gradient-to-r from-primary-500 to-terracotta-400',
  terracotta: 'bg-gradient-to-r from-sky-silk-300 to-[#87CEEB]',
  secondary: 'bg-gradient-to-r from-[#27AE60] to-[#2ECC71]',
  'sky-silk': 'bg-gradient-to-r from-secondary-500 to-secondary-400',
};

export const categoryIconBg: Record<string, string> = {
  primary: 'bg-[var(--tint-orange-15)]',
  terracotta: 'bg-[var(--tint-silk-20)]',
  secondary: 'bg-[var(--tint-success-10)]',
  'sky-silk': 'bg-[var(--tint-slate-5)]',
};

export const categoryBadgeBg: Record<string, string> = {
  primary: 'bg-primary-50 text-primary-600',
  terracotta: 'bg-orange-50 text-terracotta-400',
  secondary: 'bg-secondary-50 text-secondary-500',
  'sky-silk': 'bg-sky-silk-50 text-secondary-400',
};

/**
 * English copy lifted from src/services/translation/uiStrings.ts. Kept
 * verbatim so the Astro pages read identically to what authenticated users
 * see in the Vue app.
 */
export const HELP_LABELS: Record<string, string> = {
  title: 'Help Center',
  heroTitle: 'how can we help?',
  heroBadge: 'beanies.family help center',
  subtitle:
    'Everything you need to know about your family\u2019s favourite bean counter \u2014 from first pod to full financial planning.',
  searchPlaceholder: 'search for anything... encryption, budgets, activities...',
  noResults: 'No articles found. Try a different search term.',
  browseByTopic: 'Browse by Topic',
  popularArticles: 'Popular Reads',
  viewAllArticles: 'View all articles',
  allArticles: 'All Topics',
  allArticlesSubtitle: 'Browse by category to find exactly what you need.',
  exploreOtherTopics: 'Explore other topics',
  securitySpotlightTitle: 'Your beans are safe with us',
  securitySpotlightDesc:
    'beanies.family uses bank-grade encryption that runs entirely in your browser. Your data never touches our servers unencrypted \u2014 because it never touches our servers at all.',
  securityFeature1Title: 'AES-256-GCM Encryption',
  securityFeature1Desc:
    'The same authenticated encryption used by governments and banks. Every byte of your family data is encrypted before it leaves memory.',
  securityFeature2Title: 'PBKDF2 Key Derivation',
  securityFeature2Desc:
    'Your password is strengthened through 100,000 rounds of PBKDF2-SHA256 before it becomes an encryption key.',
  securityFeature3Title: 'Per-Member Key Wrapping',
  securityFeature3Desc:
    'Each family member has their own wrapped copy of the family key. Change your password without re-encrypting the entire file.',
  securityFeature4Title: 'Browser-Native Crypto',
  securityFeature4Desc:
    'All encryption uses the Web Crypto API built into your browser \u2014 no third-party libraries, no external dependencies.',
  diagramTitle: 'How your data is protected',
  diagramStep1: 'Your password + random salt',
  diagramStep2: 'PBKDF2 (100,000 rounds) \u2192 AES key',
  diagramStep3: 'AES-KW unwraps the family key',
  diagramStep4: 'Family key decrypts your .beanpod',
  diagramCaption: 'All of this happens in your browser. Nothing is sent anywhere.',
  learnMoreSecurity: 'Learn more about security',
  chatbotTeaser: 'Bean Assistant \u2014 Coming Soon',
  chatbotTeaserDesc:
    'Ask anything about your finances, features, or how things work \u2014 and get instant answers from your personal bean assistant.',
  chatbotMockAnswer:
    'Net worth = (accounts + assets) \u2212 liabilities. All converted to your base currency!',
  chatbotInputPlaceholder: 'Ask me anything about beanies.family...',
  onThisPage: 'On This Page',
  wasHelpful: 'Was this article helpful?',
  yes: 'Yes',
  no: 'No',
  feedbackThanks: 'Thanks for your feedback!',
  articleNotFound: 'Article not found',
  backToHelp: 'Back to Help Center',
  noArticlesInCategory: 'No articles in this category yet.',
};

/** English labels + descriptions for HELP_CATEGORIES (keyed by category id). */
export const CATEGORY_COPY: Record<string, { label: string; description: string }> = {
  'whats-new': {
    label: "What's New",
    description:
      'Release notes and recent improvements \u2014 straight from the head beanie developer.',
  },
  'getting-started': {
    label: 'Getting Started',
    description: 'Create your first pod, add family members, and start tracking your beans.',
  },
  features: {
    label: 'Features & How-To',
    description:
      'Accounts, transactions, budgets, goals, activities, the planner, and everything in between.',
  },
  security: {
    label: 'Security & Privacy',
    description:
      'How we encrypt your data, protect your keys, and keep your beans safe \u2014 with full transparency.',
  },
  'how-it-works': {
    label: 'How It Works',
    description:
      'The logic behind the numbers \u2014 how calculations, summaries, and smart features work under the hood.',
  },
};
