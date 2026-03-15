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
  { icon: '🎹', label: 'Piano', category: 'piano', defaultTitle: 'Piano Lessons' },
  { icon: '🎾', label: 'Tennis', category: 'tennis', defaultTitle: 'Tennis Practice' },
  { icon: '🎨', label: 'Art', category: 'art', defaultTitle: 'Art Class' },
  { icon: '💃', label: 'Dance', category: 'dance', defaultTitle: 'Dance Class' },
  { icon: '📚', label: 'Tutoring', category: 'tutoring', defaultTitle: 'Tutoring' },
  { icon: '🎂', label: 'Birthday', category: 'birthday', defaultTitle: 'Birthday Party' },
  {
    icon: '🏫',
    label: 'After School',
    category: 'after_school',
    defaultTitle: 'After School Activity',
  },
  { icon: '📓', label: 'Other', category: 'other_lesson', defaultTitle: 'Activity' },
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
    icon: '\u{1F4CA}',
    label: 'Side Income',
    category: 'freelance',
    type: 'income',
    defaultName: 'Side Income',
  },
];

export const RECURRING_EXPENSE_PRESETS: RecurringPreset[] = [
  {
    icon: '\u{1F3E0}',
    label: 'Rent',
    category: 'rent',
    type: 'expense',
    defaultName: 'Rent / Mortgage',
  },
  {
    icon: '\u{1F697}',
    label: 'Car',
    category: 'car_payment',
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
