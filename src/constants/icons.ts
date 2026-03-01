/**
 * Central registry of all beanie-styled SVG icon definitions.
 * Each icon uses softer, rounder shapes matching the beanies.family brand:
 * - round stroke-linecap and stroke-linejoin (enforced by BeanieIcon component)
 * - stroke-width 1.75 (lighter than Heroicons' 2.0)
 */

export interface BeanieIconDef {
  /** One or more SVG <path> d-attributes */
  paths: string[];
  /** SVG viewBox (default: '0 0 24 24') */
  viewBox?: string;
  /** Per-path: true = use fill instead of stroke */
  filled?: boolean[];
}

// ─── Navigation / Page Icons (9) ───────────────────────────────────────────

const NAV_ICONS: Record<string, BeanieIconDef> = {
  home: {
    paths: [
      'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    ],
  },
  'credit-card': {
    paths: [
      'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    ],
  },
  'arrow-right-left': {
    paths: ['M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'],
  },
  building: {
    paths: [
      'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    ],
  },
  target: {
    paths: [
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
      'M12 18a6 6 0 100-12 6 6 0 000 12z',
      'M12 14a2 2 0 100-4 2 2 0 000 4z',
    ],
  },
  'chart-bar': {
    paths: [
      'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    ],
  },
  'trending-up': {
    paths: ['M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'],
  },
  'trending-down': {
    paths: ['M13 17h8m0 0V9m0 8l-8-8-4 4-6-6'],
  },
  users: {
    paths: [
      'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    ],
  },
  cog: {
    paths: [
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
      'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    ],
  },
};

// ─── Action Icons ──────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, BeanieIconDef> = {
  plus: {
    paths: ['M12 4v16m8-8H4'],
  },
  edit: {
    paths: [
      'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    ],
  },
  trash: {
    paths: [
      'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    ],
  },
  close: {
    paths: ['M6 18L18 6M6 6l12 12'],
  },
  'chevron-down': {
    paths: ['M19 9l-7 7-7-7'],
  },
  'chevron-up': {
    paths: ['M5 15l7-7 7 7'],
  },
  'chevron-left': {
    paths: ['M15 19l-7-7 7-7'],
  },
  'chevron-right': {
    paths: ['M9 5l7 7-7 7'],
  },
  search: {
    paths: ['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'],
  },
  check: {
    paths: ['M5 13l4 4L19 7'],
  },
};

// ─── Summary Card Icons ────────────────────────────────────────────────────

const SUMMARY_ICONS: Record<string, BeanieIconDef> = {
  'dollar-circle': {
    paths: [
      'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    ],
  },
  'arrow-up': {
    paths: ['M7 11l5-5m0 0l5 5m-5-5v12'],
  },
  'arrow-down': {
    paths: ['M17 13l-5 5m0 0l-5-5m5 5V6'],
  },
  wallet: {
    paths: [
      'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    ],
  },
  'bar-chart': {
    paths: [
      'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    ],
  },
};

// ─── Utility Icons ─────────────────────────────────────────────────────────

const UTILITY_ICONS: Record<string, BeanieIconDef> = {
  calendar: {
    paths: [
      'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    ],
  },
  user: {
    paths: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
  },
  'user-filled': {
    paths: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
    filled: [true, false],
  },
  file: {
    paths: [
      'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    ],
  },
  lock: {
    paths: [
      'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    ],
  },
  unlock: {
    paths: [
      'M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z',
    ],
  },
  sun: {
    paths: [
      'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    ],
  },
  moon: {
    paths: [
      'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
    ],
  },
  refresh: {
    paths: [
      'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    ],
  },
  'external-link': {
    paths: ['M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'],
  },
  bell: {
    paths: [
      'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    ],
  },
  copy: {
    paths: [
      'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    ],
  },
};

// ─── Status Icons ──────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, BeanieIconDef> = {
  'pause-circle': {
    paths: ['M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  'play-circle': {
    paths: [
      'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z',
      'M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    ],
  },
  'check-circle': {
    paths: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  'light-bulb': {
    paths: [
      'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    ],
  },
  'exclamation-circle': {
    paths: ['M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
};

// ─── Category Icons (transaction categories) ───────────────────────────────

const CATEGORY_ICONS: Record<string, BeanieIconDef> = {
  briefcase: {
    paths: [
      'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    ],
  },
  'shopping-cart': {
    paths: [
      'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    ],
  },
  utensils: {
    paths: [
      'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    ],
  },
  car: {
    paths: [
      'M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 104 0 2 2 0 00-4 0zM4 11l2-6h12l2 6M4 11h16M4 11v6h16v-6',
    ],
  },
  zap: {
    paths: ['M13 10V3L4 14h7v7l9-11h-7z'],
  },
  heart: {
    paths: [
      'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    ],
  },
  activity: {
    paths: [
      'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    ],
  },
  gift: {
    paths: [
      'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
    ],
  },
  film: {
    paths: [
      'M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z',
    ],
  },
  book: {
    paths: [
      'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    ],
  },
  code: {
    paths: ['M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4'],
  },
  'dollar-sign': {
    paths: [
      'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    ],
  },
  repeat: {
    paths: [
      'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    ],
  },
  shield: {
    paths: [
      'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    ],
  },
  coffee: {
    paths: [
      'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    ],
  },
  // Additional category icons not in v-if chain but referenced in categories.ts
  palette: {
    paths: [
      'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
    ],
  },
  paw: {
    paths: [
      'M12 21c-1.5 0-3-1-4-2.5S6 15 6 14c0-2 2-3.5 3.5-3.5S12 12 12 14m0 7c1.5 0 3-1 4-2.5s2-3.5 2-4.5c0-2-2-3.5-3.5-3.5S12 12 12 14m-5-8a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4zM5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm14 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    ],
  },
  shirt: {
    paths: ['M6 2l3 3 3-3 3 3 3-3v6l-3 2v11H9V13L6 11V2z'],
  },
  tool: {
    paths: [
      'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
    ],
  },
  'file-text': {
    paths: [
      'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    ],
  },
  'heart-handshake': {
    paths: [
      'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7 7-7z',
      'M12 5.5L8.5 9l3 2.5L15 9l-3-3.5',
    ],
  },
  'more-horizontal': {
    paths: ['M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  fuel: {
    paths: [
      'M3 22V6a2 2 0 012-2h8a2 2 0 012 2v16M3 22h12M15 14h2a2 2 0 012 2v2a2 2 0 002 2M19 6l2 2v6M7 9h4',
    ],
  },
  train: {
    paths: [
      'M4 15.5C4 17.433 5.567 19 7.5 19h9c1.933 0 3.5-1.567 3.5-3.5V7a4 4 0 00-4-4H8a4 4 0 00-4 4v8.5z',
      'M4 11h16M8 15h.01M16 15h.01M9 19l-2 3m8-3l2 3',
    ],
  },
  airplane: {
    paths: ['M12 2L2 7l4 2v6l6 5 6-5v-6l4-2-10-5zM2 7l10 5m0 0l10-5M12 12v8.5'],
  },
  hotel: {
    paths: [
      'M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 14v.01M12 14v.01M16 14v.01M8 18v.01M12 18v.01M16 18v.01',
    ],
  },
  'plus-circle': {
    paths: ['M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z'],
  },
  settings: {
    paths: [
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
      'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    ],
  },
};

// ─── Account Type Icons ────────────────────────────────────────────────────

export interface AccountTypeIconDef extends BeanieIconDef {
  color: string;
  label: string;
}

export const ACCOUNT_TYPE_ICONS: Record<string, AccountTypeIconDef> = {
  'account-checking': {
    paths: ['M3 6h18M3 12h18M3 18h18'],
    color: '#3b82f6',
    label: 'Checking',
  },
  'account-savings': {
    paths: [
      'M19 5h-14a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-10a2 2 0 00-2-2zM12 15a3 3 0 100-6 3 3 0 000 6z',
    ],
    color: '#10b981',
    label: 'Savings',
  },
  'account-credit_card': {
    paths: ['M1 5a2 2 0 012-2h18a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5zM1 10h22'],
    color: '#8b5cf6',
    label: 'Credit Card',
  },
  'account-investment': {
    paths: ['M23 6l-9.5 9.5-5-5L1 18M17 6h6v6'],
    color: '#f59e0b',
    label: 'Investment',
  },
  'account-crypto': {
    paths: [
      'M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042l-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893l-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042l.348-1.97M7.48 20.364l3.126-17.727',
    ],
    color: '#f97316',
    label: 'Crypto',
  },
  'account-cash': {
    paths: ['M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6'],
    color: '#22c55e',
    label: 'Cash',
  },
  'account-loan': {
    paths: ['M12 2v6m0 8v6M9 8h6a3 3 0 013 3v2a3 3 0 01-3 3H9a3 3 0 01-3-3v-2a3 3 0 013-3z'],
    color: '#ef4444',
    label: 'Loan',
  },
  'account-other': {
    paths: ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2'],
    color: '#6b7280',
    label: 'Other',
  },
  'account-retirement_401k': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: '401k',
  },
  'account-retirement_ira': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: 'IRA',
  },
  'account-retirement_roth_ira': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: 'ROTH IRA',
  },
  'account-retirement_bene_ira': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: 'BENE IRA',
  },
  'account-retirement_kids_ira': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: 'Kids IRA',
  },
  'account-retirement': {
    paths: [
      'M12 2L3 7v2h18V7L12 2zM5 11v6h2v-6H5zm4 0v6h2v-6H9zm4 0v6h2v-6h-2zm4 0v6h2v-6h-2zM3 19v2h18v-2H3z',
    ],
    color: '#6366f1',
    label: 'Retirement',
  },
  'account-education_529': {
    paths: ['M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z'],
    color: '#14b8a6',
    label: 'College Fund (529)',
  },
  'account-education_savings': {
    paths: ['M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z'],
    color: '#14b8a6',
    label: 'Education Savings',
  },
};

// ─── Asset Type Icons ──────────────────────────────────────────────────────

export interface AssetTypeIconDef extends BeanieIconDef {
  color: string;
}

export const ASSET_TYPE_ICONS: Record<string, AssetTypeIconDef> = {
  'asset-real_estate': {
    paths: [
      'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    ],
    color: '#3b82f6',
  },
  'asset-vehicle': {
    paths: [
      'M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zm8 0a2 2 0 104 0 2 2 0 00-4 0zM4 11l2-6h12l2 6M4 11h16M4 11v6h16v-6',
    ],
    color: '#f59e0b',
  },
  'asset-boat': {
    paths: ['M3 17h18M5 17l2-8h10l2 8M9 9V6a3 3 0 016 0v3'],
    color: '#06b6d4',
  },
  'asset-jewelry': {
    paths: ['M12 8l-3 3 3 3 3-3-3-3zm0-6l6 6-6 6-6-6 6-6z'],
    color: '#ec4899',
  },
  'asset-electronics': {
    paths: [
      'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    ],
    color: '#8b5cf6',
  },
  'asset-equipment': {
    paths: [
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
      'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    ],
    color: '#6b7280',
  },
  'asset-art': {
    paths: [
      'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    ],
    color: '#f43f5e',
  },
  'asset-collectible': {
    paths: [
      'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
    ],
    color: '#10b981',
  },
  'asset-other': {
    paths: ['M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'],
    color: '#64748b',
  },
};

// ─── Merged Icon Registry ──────────────────────────────────────────────────

export const BEANIE_ICONS: Record<string, BeanieIconDef> = {
  ...NAV_ICONS,
  ...ACTION_ICONS,
  ...SUMMARY_ICONS,
  ...UTILITY_ICONS,
  ...STATUS_ICONS,
  ...CATEGORY_ICONS,
  ...ACCOUNT_TYPE_ICONS,
  ...ASSET_TYPE_ICONS,
};

/**
 * Get an icon definition by name.
 * Returns undefined if not found.
 */
export function getIconDef(name: string): BeanieIconDef | undefined {
  return BEANIE_ICONS[name];
}

/**
 * Get an account type icon with its color metadata.
 */
export function getAccountTypeIcon(type: string): AccountTypeIconDef | undefined {
  return ACCOUNT_TYPE_ICONS[`account-${type}`];
}

/**
 * Get an asset type icon with its color metadata.
 */
export function getAssetTypeIcon(type: string): AssetTypeIconDef | undefined {
  return ASSET_TYPE_ICONS[`asset-${type}`];
}
