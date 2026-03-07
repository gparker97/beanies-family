import type { ActivityCategory } from '@/types/models';

export interface ActivityPreset {
  icon: string;
  label: string;
  category: ActivityCategory;
  defaultTitle: string;
}

/**
 * Shared activity presets used in both ActivityModal and OnboardingFamily.
 * Each preset maps an emoji to a category and default title.
 */
export const ACTIVITY_PRESETS: ActivityPreset[] = [
  { icon: '\u{1F3B9}', label: 'Piano', category: 'lesson', defaultTitle: 'Piano Lessons' },
  { icon: '\u26BD', label: 'Soccer', category: 'sport', defaultTitle: 'Soccer Practice' },
  { icon: '\u{1F3CA}', label: 'Swimming', category: 'sport', defaultTitle: 'Swimming Lessons' },
  { icon: '\u{1F3A8}', label: 'Art', category: 'lesson', defaultTitle: 'Art Class' },
  { icon: '\u{1F94B}', label: 'Martial Arts', category: 'sport', defaultTitle: 'Martial Arts' },
  { icon: '\u{1F483}', label: 'Dance', category: 'lesson', defaultTitle: 'Dance Class' },
  { icon: '\u{1F4DA}', label: 'Tutoring', category: 'lesson', defaultTitle: 'Tutoring' },
  { icon: '\u{1F4E6}', label: 'Other', category: 'other', defaultTitle: 'Activity' },
];

/**
 * Onboarding-specific recurring transaction presets.
 */
export interface RecurringPreset {
  icon: string;
  label: string;
  category: string;
  type: 'income' | 'expense';
  defaultName: string;
}

export const RECURRING_INCOME_PRESETS: RecurringPreset[] = [
  { icon: '\u{1F4B0}', label: 'Salary', category: 'salary', type: 'income', defaultName: 'Salary' },
  {
    icon: '\u{1F469}\u200D\u{1F4BC}',
    label: "Partner's Income",
    category: 'salary',
    type: 'income',
    defaultName: "Partner's Income",
  },
  {
    icon: '\u{1F4CA}',
    label: 'Side Income',
    category: 'side_income',
    type: 'income',
    defaultName: 'Side Income',
  },
];

export const RECURRING_EXPENSE_PRESETS: RecurringPreset[] = [
  {
    icon: '\u{1F3E0}',
    label: 'Rent',
    category: 'housing',
    type: 'expense',
    defaultName: 'Rent / Mortgage',
  },
  {
    icon: '\u{1F697}',
    label: 'Car',
    category: 'transport',
    type: 'expense',
    defaultName: 'Car Payment',
  },
  {
    icon: '\u26A1',
    label: 'Utilities',
    category: 'utilities',
    type: 'expense',
    defaultName: 'Utilities',
  },
  {
    icon: '\u{1F4F1}',
    label: 'Phone',
    category: 'utilities',
    type: 'expense',
    defaultName: 'Phone Plan',
  },
  {
    icon: '\u{1F6E1}\uFE0F',
    label: 'Insurance',
    category: 'insurance',
    type: 'expense',
    defaultName: 'Insurance',
  },
];
