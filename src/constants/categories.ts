import type { Category } from '@/types/models';

// ── Income Categories (12 categories, 4 groups) ────────────────────────────

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
  {
    id: 'consultancy',
    name: 'Consultancy',
    icon: 'handshake',
    type: 'income',
    color: '#059669',
    group: 'Employment',
  },
  {
    id: 'other_employment',
    name: 'Other Employment Income',
    icon: 'briefcase',
    type: 'income',
    color: '#16a34a',
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
  {
    id: 'other_investment',
    name: 'Other Investment Income',
    icon: 'bar-chart',
    type: 'income',
    color: '#0d9488',
    group: 'Investments',
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
  {
    id: 'other_property',
    name: 'Other Property Income',
    icon: 'home',
    type: 'income',
    color: '#0284c7',
    group: 'Property',
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
    id: 'refunds',
    name: 'Refunds',
    icon: 'refresh',
    type: 'income',
    color: '#0369a1',
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
];

// ── Expense Categories (46 categories, 13 groups) ──────────────────────────

export const EXPENSE_CATEGORIES: Category[] = [
  // Charity
  {
    id: 'donations',
    name: 'Donations',
    icon: 'heart-handshake',
    type: 'expense',
    color: '#475569',
    group: 'Charity',
  },
  {
    id: 'gifts_given',
    name: 'Gifts Given',
    icon: 'gift',
    type: 'expense',
    color: '#64748b',
    group: 'Charity',
  },
  {
    id: 'other_charity',
    name: 'Other Charity',
    icon: 'hand-heart',
    type: 'expense',
    color: '#374151',
    group: 'Charity',
  },

  // Education / Lessons
  {
    id: 'tuition',
    name: 'Tutor / Tuition',
    icon: 'book-open',
    type: 'expense',
    color: '#7e22ce',
    group: 'Education / Lessons',
  },
  {
    id: 'school_fees',
    name: 'School Fees',
    icon: 'school',
    type: 'expense',
    color: '#6b21a8',
    group: 'Education / Lessons',
  },
  {
    id: 'other_lessons',
    name: 'Other Lessons',
    icon: 'graduation-cap',
    type: 'expense',
    color: '#581c87',
    group: 'Education / Lessons',
  },

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
    id: 'other_entertainment',
    name: 'Other Entertainment',
    icon: 'theater',
    type: 'expense',
    color: '#6d28d9',
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
  { id: 'pets', name: 'Pets', icon: 'paw', type: 'expense', color: '#881337', group: 'Family' },
  {
    id: 'other_family',
    name: 'Other Family',
    icon: 'users',
    type: 'expense',
    color: '#9f1239',
    group: 'Family',
  },

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
    name: 'Coffee / Snacks',
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
  {
    id: 'other_food',
    name: 'Other Food',
    icon: 'utensils',
    type: 'expense',
    color: '#0d9488',
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
    name: 'Rent / Mortgage',
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
  {
    id: 'other_housing',
    name: 'Other Housing',
    icon: 'building',
    type: 'expense',
    color: '#d97706',
    group: 'Housing',
  },

  // Medical
  {
    id: 'healthcare',
    name: 'Healthcare',
    icon: 'activity',
    type: 'expense',
    color: '#dc2626',
    group: 'Medical',
  },
  {
    id: 'dental',
    name: 'Dental',
    icon: 'smile',
    type: 'expense',
    color: '#b91c1c',
    group: 'Medical',
  },
  {
    id: 'other_medical',
    name: 'Other Medical Expense',
    icon: 'stethoscope',
    type: 'expense',
    color: '#991b1b',
    group: 'Medical',
  },

  // Other
  {
    id: 'other_expense',
    name: 'Other Expense',
    icon: 'more-horizontal',
    type: 'expense',
    color: '#334155',
    group: 'Other',
  },

  // Personal
  {
    id: 'clothing',
    name: 'Clothing / Shopping',
    icon: 'shirt',
    type: 'expense',
    color: '#0284c7',
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
  {
    id: 'other_personal',
    name: 'Other Personal',
    icon: 'shopping-bag',
    type: 'expense',
    color: '#1d4ed8',
    group: 'Personal',
  },

  // Sports
  {
    id: 'sports_equipment',
    name: 'Sports Equipment',
    icon: 'dumbbell',
    type: 'expense',
    color: '#15803d',
    group: 'Sports',
  },
  {
    id: 'sports_team',
    name: 'Sports Team / Practice',
    icon: 'users',
    type: 'expense',
    color: '#166534',
    group: 'Sports',
  },
  { id: 'golf', name: 'Golf', icon: 'flag', type: 'expense', color: '#14532d', group: 'Sports' },
  {
    id: 'gym',
    name: 'Gym / Fitness',
    icon: 'dumbbell',
    type: 'expense',
    color: '#22c55e',
    group: 'Sports',
  },
  {
    id: 'yoga',
    name: 'Yoga / Pilates',
    icon: 'heart',
    type: 'expense',
    color: '#16a34a',
    group: 'Sports',
  },
  {
    id: 'other_sports',
    name: 'Other Sports',
    icon: 'activity',
    type: 'expense',
    color: '#059669',
    group: 'Sports',
  },

  // Subscriptions
  {
    id: 'software',
    name: 'Software',
    icon: 'monitor',
    type: 'expense',
    color: '#7c3aed',
    group: 'Subscriptions',
  },
  {
    id: 'streaming',
    name: 'Streaming',
    icon: 'tv',
    type: 'expense',
    color: '#8b5cf6',
    group: 'Subscriptions',
  },
  {
    id: 'other_subscriptions',
    name: 'Other Subscriptions',
    icon: 'repeat',
    type: 'expense',
    color: '#6366f1',
    group: 'Subscriptions',
  },

  // Transportation
  {
    id: 'car_maintenance',
    name: 'Car / Bike Maintenance',
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
    name: 'Gas / Fuel',
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
  {
    id: 'taxi',
    name: 'Taxi / Ride Hailing',
    icon: 'navigation',
    type: 'expense',
    color: '#a3e635',
    group: 'Transportation',
  },
  {
    id: 'other_transportation',
    name: 'Other Transportation',
    icon: 'car',
    type: 'expense',
    color: '#65a30d',
    group: 'Transportation',
  },

  // Travel
  {
    id: 'flights',
    name: 'Flight',
    icon: 'airplane',
    type: 'expense',
    color: '#be123c',
    group: 'Travel',
  },
  { id: 'hotel', name: 'Hotel', icon: 'hotel', type: 'expense', color: '#a21caf', group: 'Travel' },
  {
    id: 'other_travel',
    name: 'Other Travel',
    icon: 'luggage',
    type: 'expense',
    color: '#86198f',
    group: 'Travel',
  },
];

export const ALL_CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

// ── Emoji Maps ─────────────────────────────────────────────────────────────

export const CATEGORY_EMOJI_MAP: Record<string, string> = {
  // Income
  freelance: '💻',
  salary: '💼',
  consultancy: '🤝',
  other_employment: '💼',
  dividends: '💰',
  investments: '📈',
  other_investment: '📊',
  rental: '🏠',
  other_property: '🏡',
  gifts: '🎁',
  refunds: '🔄',
  other_income: '📦',
  // Expense — Charity
  donations: '💝',
  gifts_given: '🎁',
  other_charity: '🤲',
  // Expense — Education / Lessons
  tuition: '📚',
  school_fees: '🏫',
  other_lessons: '🎓',
  // Expense — Entertainment
  entertainment: '🎬',
  hobbies: '🎨',
  other_entertainment: '🎭',
  // Expense — Family
  childcare: '👶',
  pets: '🐾',
  other_family: '👨‍👩‍👧',
  // Expense — Financial
  debt_payment: '💳',
  insurance: '🔒',
  taxes: '📄',
  // Expense — Food
  coffee: '☕',
  dining_out: '🍽️',
  groceries: '🛒',
  other_food: '🍴',
  // Expense — Housing
  home_maintenance: '🔨',
  rent: '🏠',
  utilities: '⚡',
  other_housing: '🏗️',
  // Expense — Medical
  healthcare: '🏥',
  dental: '🦷',
  other_medical: '⚕️',
  // Expense — Other
  other_expense: '📦',
  // Expense — Personal
  clothing: '👕',
  personal_care: '💅',
  other_personal: '🛍️',
  // Expense — Sports
  sports_equipment: '🏅',
  sports_team: '⚽',
  golf: '⛳',
  gym: '🏋️',
  yoga: '🧘',
  other_sports: '🏃',
  // Expense — Subscriptions
  software: '💻',
  streaming: '📺',
  other_subscriptions: '📱',
  // Expense — Transportation
  car_maintenance: '🔧',
  car_payment: '🚗',
  gas: '⛽',
  public_transit: '🚌',
  taxi: '🚕',
  other_transportation: '🚙',
  // Expense — Travel
  flights: '✈️',
  hotel: '🏨',
  other_travel: '🧳',
};

export const GROUP_EMOJI_MAP: Record<string, string> = {
  // Income groups
  Employment: '💼',
  Investments: '📈',
  Property: '🏡',
  // Expense groups
  Charity: '💝',
  'Education / Lessons': '🎓',
  Entertainment: '🎬',
  Family: '👶',
  Financial: '💳',
  Food: '🍽️',
  Housing: '🏠',
  Medical: '🏥',
  Other: '📦',
  Personal: '💅',
  Sports: '🏅',
  Subscriptions: '📱',
  Transportation: '🚗',
  Travel: '✈️',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

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

/** Get the list of category IDs belonging to a given expense group name */
export function getCategoryIdsForGroup(groupName: string): string[] {
  return EXPENSE_CATEGORIES.filter((c) => c.group === groupName).map((c) => c.id);
}

/** Budget group-level helpers */
const GROUP_PREFIX = 'group:';

export function isGroupBudget(categoryId: string): boolean {
  return categoryId.startsWith(GROUP_PREFIX);
}

export function getGroupName(categoryId: string): string {
  return categoryId.slice(GROUP_PREFIX.length);
}

export function makeGroupBudgetId(groupName: string): string {
  return `${GROUP_PREFIX}${groupName}`;
}
