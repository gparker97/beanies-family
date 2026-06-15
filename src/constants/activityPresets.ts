import type { ActivityCategory } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ActivityPreset {
  icon: string;
  labelKey: UIStringKey;
  category: ActivityCategory;
  defaultTitle: string;
}

/**
 * Shared activity presets used in both ActivityModal and OnboardingActivity.
 * Each preset maps an emoji to a category and default title.
 */
export const ACTIVITY_PRESETS: ActivityPreset[] = [
  {
    icon: '🎹',
    labelKey: 'activityPreset.piano',
    category: 'piano',
    defaultTitle: 'Piano Lessons',
  },
  {
    icon: '🎾',
    labelKey: 'activityPreset.tennis',
    category: 'tennis',
    defaultTitle: 'Tennis Practice',
  },
  { icon: '🎨', labelKey: 'activityPreset.art', category: 'art', defaultTitle: 'Art Class' },
  { icon: '💃', labelKey: 'activityPreset.dance', category: 'dance', defaultTitle: 'Dance Class' },
  {
    icon: '📚',
    labelKey: 'activityPreset.tutoring',
    category: 'tutoring',
    defaultTitle: 'Tutoring',
  },
  {
    icon: '🎂',
    labelKey: 'activityPreset.birthday',
    category: 'birthday',
    defaultTitle: 'Birthday Party',
  },
  {
    icon: '🏫',
    labelKey: 'activityPreset.afterSchool',
    category: 'after_school',
    defaultTitle: 'After School Activity',
  },
  {
    icon: '📓',
    labelKey: 'activityPreset.other',
    category: 'other_lesson',
    defaultTitle: 'Activity',
  },
];

/**
 * Onboarding-specific recurring transaction presets.
 */
export interface RecurringPreset {
  icon: string;
  labelKey: UIStringKey;
  category: string;
  type: 'income' | 'expense';
  defaultName: string;
}

export const RECURRING_INCOME_PRESETS: RecurringPreset[] = [
  {
    icon: '\u{1F4B0}',
    labelKey: 'activityPreset.salary',
    category: 'salary',
    type: 'income',
    defaultName: 'Salary',
  },
  {
    icon: '\u{1F4CA}',
    labelKey: 'activityPreset.sideIncome',
    category: 'freelance',
    type: 'income',
    defaultName: 'Side Income',
  },
];

export const RECURRING_EXPENSE_PRESETS: RecurringPreset[] = [
  {
    icon: '\u{1F3E0}',
    labelKey: 'activityPreset.rent',
    category: 'rent',
    type: 'expense',
    defaultName: 'Rent / Mortgage',
  },
  {
    icon: '\u{1F697}',
    labelKey: 'activityPreset.car',
    category: 'car_payment',
    type: 'expense',
    defaultName: 'Car Payment',
  },
  {
    icon: '\u26A1',
    labelKey: 'activityPreset.utilities',
    category: 'utilities',
    type: 'expense',
    defaultName: 'Utilities',
  },
  {
    icon: '\u{1F4F1}',
    labelKey: 'activityPreset.phone',
    category: 'utilities',
    type: 'expense',
    defaultName: 'Phone Plan',
  },
  {
    icon: '\u{1F6E1}\uFE0F',
    labelKey: 'activityPreset.insurance',
    category: 'insurance',
    type: 'expense',
    defaultName: 'Insurance',
  },
];
