import type { AccountType } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AccountSubtype {
  type: AccountType;
  labelKey: UIStringKey;
  emoji: string;
}

export interface AccountSubgroup {
  labelKey?: UIStringKey; // omit for ungrouped subtypes
  subtypes: AccountSubtype[];
}

export interface AccountCategory {
  id: string;
  labelKey: UIStringKey;
  emoji: string;
  /** If set, selecting this category auto-selects the type (no expansion) */
  autoSelect?: AccountType;
  /** Flat subtypes (e.g. Bank → Savings, Checking, Credit Card) */
  subtypes?: AccountSubtype[];
  /** Grouped subtypes (e.g. Investment → ungrouped + Retirement + Education) */
  subgroups?: AccountSubgroup[];
}

// ─── Category Hierarchy ─────────────────────────────────────────────────────

export const ACCOUNT_CATEGORIES: AccountCategory[] = [
  {
    id: 'bank',
    labelKey: 'accounts.cat.bank',
    emoji: '🏦',
    subtypes: [
      { type: 'savings', labelKey: 'accounts.subtype.savings', emoji: '🐷' },
      { type: 'checking', labelKey: 'accounts.subtype.checking', emoji: '🏦' },
      { type: 'credit_card', labelKey: 'accounts.subtype.creditCard', emoji: '💳' },
    ],
  },
  {
    id: 'investment',
    labelKey: 'accounts.cat.investment',
    emoji: '📈',
    subtypes: [
      { type: 'investment', labelKey: 'accounts.subtype.brokerage', emoji: '📈' },
      { type: 'crypto', labelKey: 'accounts.subtype.crypto', emoji: '₿' },
      { type: 'education_529', labelKey: 'accounts.subtype.collegeFund529', emoji: '🎓' },
      { type: 'education_savings', labelKey: 'accounts.subtype.educationSavings', emoji: '🎓' },
    ],
  },
  {
    id: 'retirement',
    labelKey: 'accounts.cat.retirement',
    emoji: '🏛️',
    subtypes: [
      { type: 'retirement_401k', labelKey: 'accounts.subtype.401k', emoji: '🏛️' },
      { type: 'retirement_ira', labelKey: 'accounts.subtype.ira', emoji: '🏛️' },
      { type: 'retirement_roth_ira', labelKey: 'accounts.subtype.rothIra', emoji: '🏛️' },
      { type: 'retirement_bene_ira', labelKey: 'accounts.subtype.beneIra', emoji: '🏛️' },
      { type: 'retirement_kids_ira', labelKey: 'accounts.subtype.kidsIra', emoji: '🏛️' },
      { type: 'retirement', labelKey: 'accounts.subtype.retirementGeneral', emoji: '🏛️' },
    ],
  },
  {
    id: 'cash',
    labelKey: 'accounts.cat.cash',
    emoji: '💵',
    autoSelect: 'cash',
  },
  {
    id: 'loan',
    labelKey: 'accounts.cat.loan',
    emoji: '🏦',
    autoSelect: 'loan',
  },
  {
    id: 'other',
    labelKey: 'accounts.cat.other',
    emoji: '📦',
    autoSelect: 'other',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Flat list of all subtypes across all categories */
function allSubtypes(): AccountSubtype[] {
  const result: AccountSubtype[] = [];
  for (const cat of ACCOUNT_CATEGORIES) {
    if (cat.autoSelect) {
      result.push({ type: cat.autoSelect, labelKey: cat.labelKey, emoji: cat.emoji });
    }
    if (cat.subtypes) {
      result.push(...cat.subtypes);
    }
    if (cat.subgroups) {
      for (const group of cat.subgroups) {
        result.push(...group.subtypes);
      }
    }
  }
  return result;
}

const _subtypeMap = new Map<AccountType, AccountSubtype>();
const _categoryMap = new Map<AccountType, AccountCategory>();

for (const cat of ACCOUNT_CATEGORIES) {
  if (cat.autoSelect) {
    _subtypeMap.set(cat.autoSelect, {
      type: cat.autoSelect,
      labelKey: cat.labelKey,
      emoji: cat.emoji,
    });
    _categoryMap.set(cat.autoSelect, cat);
  }
  if (cat.subtypes) {
    for (const sub of cat.subtypes) {
      _subtypeMap.set(sub.type, sub);
      _categoryMap.set(sub.type, cat);
    }
  }
  if (cat.subgroups) {
    for (const group of cat.subgroups) {
      for (const sub of group.subtypes) {
        _subtypeMap.set(sub.type, sub);
        _categoryMap.set(sub.type, cat);
      }
    }
  }
}

/** Get the parent category for a given AccountType */
export function getCategoryForType(type: AccountType): AccountCategory | undefined {
  return _categoryMap.get(type);
}

/** Get the emoji for a given AccountType */
export function getSubtypeEmoji(type: AccountType): string {
  return _subtypeMap.get(type)?.emoji ?? '📦';
}

/** Get the i18n label key for a given AccountType */
export function getSubtypeLabelKey(type: AccountType): string {
  return _subtypeMap.get(type)?.labelKey ?? 'accounts.cat.other';
}

/** Get all subtypes as a flat array */
export function getAllAccountSubtypes(): AccountSubtype[] {
  return allSubtypes();
}
