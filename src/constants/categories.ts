import type { Category } from '@/types/models';

// Income category groups (alphabetically ordered)
export const INCOME_CATEGORIES: Category[] = [
  // Employment
  {
    id: 'freelance',
    name: 'Freelance',
    icon: 'code',
    type: 'income',
    color: '#10b981',
    group: 'Employment',
  },
  {
    id: 'salary',
    name: 'Salary',
    icon: 'briefcase',
    type: 'income',
    color: '#22c55e',
    group: 'Employment',
  },

  // Investments
  {
    id: 'dividends',
    name: 'Dividends',
    icon: 'dollar-sign',
    type: 'income',
    color: '#0891b2',
    group: 'Investments',
  },
  {
    id: 'investments',
    name: 'Investment Returns',
    icon: 'trending-up',
    type: 'income',
    color: '#14b8a6',
    group: 'Investments',
  },

  // Other
  {
    id: 'gifts',
    name: 'Gifts Received',
    icon: 'gift',
    type: 'income',
    color: '#0284c7',
    group: 'Other',
  },
  {
    id: 'other_income',
    name: 'Other Income',
    icon: 'plus-circle',
    type: 'income',
    color: '#059669',
    group: 'Other',
  },
  {
    id: 'refunds',
    name: 'Refunds',
    icon: 'refresh',
    type: 'income',
    color: '#0369a1',
    group: 'Other',
  },

  // Property
  {
    id: 'rental',
    name: 'Rental Income',
    icon: 'home',
    type: 'income',
    color: '#06b6d4',
    group: 'Property',
  },
];

// Expense category groups (alphabetically ordered)
export const EXPENSE_CATEGORIES: Category[] = [
  // Entertainment
  {
    id: 'entertainment',
    name: 'Entertainment',
    icon: 'film',
    type: 'expense',
    color: '#4f46e5',
    group: 'Entertainment',
  },
  {
    id: 'hobbies',
    name: 'Hobbies',
    icon: 'palette',
    type: 'expense',
    color: '#9333ea',
    group: 'Entertainment',
  },
  {
    id: 'subscriptions',
    name: 'Subscriptions',
    icon: 'repeat',
    type: 'expense',
    color: '#7c3aed',
    group: 'Entertainment',
  },

  // Family
  {
    id: 'childcare',
    name: 'Childcare',
    icon: 'users',
    type: 'expense',
    color: '#be123c',
    group: 'Family',
  },
  {
    id: 'education',
    name: 'Education',
    icon: 'book',
    type: 'expense',
    color: '#9f1239',
    group: 'Family',
  },
  { id: 'pets', name: 'Pets', icon: 'paw', type: 'expense', color: '#881337', group: 'Family' },

  // Financial
  {
    id: 'debt_payment',
    name: 'Debt Payment',
    icon: 'credit-card',
    type: 'expense',
    color: '#e11d48',
    group: 'Financial',
  },
  {
    id: 'insurance',
    name: 'Insurance',
    icon: 'shield',
    type: 'expense',
    color: '#c026d3',
    group: 'Financial',
  },
  {
    id: 'taxes',
    name: 'Taxes',
    icon: 'file-text',
    type: 'expense',
    color: '#db2777',
    group: 'Financial',
  },

  // Food
  {
    id: 'coffee',
    name: 'Coffee/Snacks',
    icon: 'coffee',
    type: 'expense',
    color: '#0891b2',
    group: 'Food',
  },
  {
    id: 'dining_out',
    name: 'Dining Out',
    icon: 'utensils',
    type: 'expense',
    color: '#06b6d4',
    group: 'Food',
  },
  {
    id: 'groceries',
    name: 'Groceries',
    icon: 'shopping-cart',
    type: 'expense',
    color: '#14b8a6',
    group: 'Food',
  },

  // Housing
  {
    id: 'home_maintenance',
    name: 'Home Maintenance',
    icon: 'tool',
    type: 'expense',
    color: '#f59e0b',
    group: 'Housing',
  },
  {
    id: 'rent',
    name: 'Rent/Mortgage',
    icon: 'home',
    type: 'expense',
    color: '#ef4444',
    group: 'Housing',
  },
  {
    id: 'utilities',
    name: 'Utilities',
    icon: 'zap',
    type: 'expense',
    color: '#f97316',
    group: 'Housing',
  },

  // Other
  {
    id: 'donations',
    name: 'Donations',
    icon: 'heart-handshake',
    type: 'expense',
    color: '#475569',
    group: 'Other',
  },
  {
    id: 'gifts_given',
    name: 'Gifts Given',
    icon: 'gift',
    type: 'expense',
    color: '#64748b',
    group: 'Other',
  },
  {
    id: 'other_expense',
    name: 'Other',
    icon: 'more-horizontal',
    type: 'expense',
    color: '#334155',
    group: 'Other',
  },

  // Personal
  {
    id: 'clothing',
    name: 'Clothing',
    icon: 'shirt',
    type: 'expense',
    color: '#0284c7',
    group: 'Personal',
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    icon: 'activity',
    type: 'expense',
    color: '#1d4ed8',
    group: 'Personal',
  },
  {
    id: 'personal_care',
    name: 'Personal Care',
    icon: 'heart',
    type: 'expense',
    color: '#0369a1',
    group: 'Personal',
  },

  // Transportation
  {
    id: 'car_maintenance',
    name: 'Car Maintenance',
    icon: 'settings',
    type: 'expense',
    color: '#10b981',
    group: 'Transportation',
  },
  {
    id: 'car_payment',
    name: 'Car Payment',
    icon: 'car',
    type: 'expense',
    color: '#eab308',
    group: 'Transportation',
  },
  {
    id: 'gas',
    name: 'Gas/Fuel',
    icon: 'fuel',
    type: 'expense',
    color: '#84cc16',
    group: 'Transportation',
  },
  {
    id: 'public_transit',
    name: 'Public Transit',
    icon: 'train',
    type: 'expense',
    color: '#22c55e',
    group: 'Transportation',
  },

  // Travel
  {
    id: 'flights',
    name: 'Flights',
    icon: 'airplane',
    type: 'expense',
    color: '#be123c',
    group: 'Travel',
  },
  { id: 'hotel', name: 'Hotel', icon: 'hotel', type: 'expense', color: '#a21caf', group: 'Travel' },
];

export const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

// Category ID → emoji mapping
export const CATEGORY_EMOJI_MAP: Record<string, string> = {
  // Expense
  rent: '🏠',
  groceries: '🛒',
  dining_out: '🍽️',
  gas: '⛽',
  utilities: '⚡',
  healthcare: '🏥',
  education: '🎓',
  subscriptions: '📱',
  entertainment: '🎬',
  clothing: '👕',
  insurance: '🔒',
  coffee: '☕',
  childcare: '👶',
  pets: '🐾',
  car_payment: '🚗',
  car_maintenance: '🔧',
  public_transit: '🚌',
  home_maintenance: '🔨',
  debt_payment: '💳',
  taxes: '📄',
  donations: '💝',
  gifts_given: '🎁',
  hobbies: '🎨',
  personal_care: '💅',
  flights: '✈️',
  hotel: '🏨',
  other_expense: '📦',
  // Income
  salary: '💼',
  freelance: '💻',
  dividends: '💰',
  investments: '📈',
  gifts: '🎁',
  rental: '🏠',
  refunds: '🔄',
  other_income: '📦',
};

// Group name → emoji mapping
export const GROUP_EMOJI_MAP: Record<string, string> = {
  Entertainment: '🎬',
  Family: '👶',
  Financial: '💳',
  Food: '🍽️',
  Housing: '🏠',
  Other: '📦',
  Personal: '💅',
  Transportation: '🚗',
  Travel: '✈️',
  Employment: '💼',
  Investments: '📈',
  Property: '🏡',
};

export function getCategoryById(id: string): Category | undefined {
  return ALL_CATEGORIES.find((cat) => cat.id === id);
}

export function getCategoriesByType(type: 'income' | 'expense'): Category[] {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

// Group categories by their group property
export interface CategoryGroup {
  name: string;
  categories: Category[];
}

export function getCategoriesGrouped(type: 'income' | 'expense'): CategoryGroup[] {
  const categories = getCategoriesByType(type);
  const groupMap = new Map<string, Category[]>();

  for (const cat of categories) {
    const groupName = cat.group || 'Other';
    const existing = groupMap.get(groupName) || [];
    existing.push(cat);
    groupMap.set(groupName, existing);
  }

  // Convert to array and sort by group name
  const groups: CategoryGroup[] = [];
  for (const [name, cats] of groupMap.entries()) {
    groups.push({
      name,
      categories: cats.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
