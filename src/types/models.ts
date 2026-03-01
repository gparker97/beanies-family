// Type aliases for clarity
export type UUID = string;
export type ISODateString = string;
export type CurrencyCode = string; // ISO 4217 codes (e.g., 'USD', 'EUR', 'GBP')
export type LanguageCode = 'en' | 'zh'; // Supported UI languages

// Family - Top-level tenant entity (one per family)
export interface Family {
  id: UUID;
  name: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// UserFamilyMapping - Maps users to families
export interface UserFamilyMapping {
  id: UUID;
  email: string;
  familyId: UUID;
  familyRole: 'owner' | 'admin' | 'member';
  memberId: UUID; // FK to FamilyMember in per-family DB
  lastActiveAt: ISODateString;
}

// GlobalSettings - Device-level settings (stored in registry DB, not per-family)
export interface GlobalSettings {
  id: 'global_settings';
  theme: 'light' | 'dark' | 'system';
  language: LanguageCode;
  lastActiveFamilyId: UUID | null;
  exchangeRates: ExchangeRate[];
  exchangeRateAutoUpdate: boolean;
  exchangeRateLastFetch: ISODateString | null;
  beanieMode?: boolean;
  soundEnabled?: boolean;
  isTrustedDevice?: boolean;
  trustedDevicePromptShown?: boolean;
  cachedEncryptionPasswords?: Record<string, string>;
  passkeyPromptShown?: boolean;
}

// PasskeyRegistration - Stored in registry DB (survives sign-out)
export interface PasskeyRegistration {
  credentialId: string; // base64url credential ID (keyPath)
  memberId: UUID; // FK to FamilyMember
  familyId: UUID; // FK to Family
  publicKey: string; // base64 public key
  transports?: string[]; // AuthenticatorTransport hints
  prfSupported: boolean; // PRF available during registration?
  cachedPassword?: string; // Cached encryption password for file decryption
  label: string; // e.g. "MacBook Touch ID"
  createdAt: ISODateString;
  lastUsedAt?: ISODateString;
}

// Family member gender and age group for avatar selection
export type Gender = 'male' | 'female' | 'other';
export type AgeGroup = 'adult' | 'child';

// Date of birth (month and day required, year optional)
export interface DateOfBirth {
  month: number; // 1-12
  day: number; // 1-31
  year?: number;
}

// FamilyMember - Each family member has their own profile
export interface FamilyMember {
  id: UUID;
  name: string;
  email: string;
  avatar?: string;
  gender: Gender;
  ageGroup: AgeGroup;
  dateOfBirth?: DateOfBirth;
  role: 'owner' | 'admin' | 'member';
  color: string; // UI differentiation
  passwordHash?: string; // PBKDF2 hash in "salt:hash" format
  requiresPassword: boolean; // true when member needs to set a password
  lastLoginAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Account - Bank accounts, credit cards, investments
export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'investment'
  | 'crypto'
  | 'cash'
  | 'loan'
  | 'other';

export interface Account {
  id: UUID;
  memberId: UUID;
  name: string;
  icon?: string; // Emoji icon (e.g. "🏦")
  type: AccountType;
  currency: CurrencyCode;
  balance: number;
  institution?: string;
  institutionCountry?: string;
  isActive: boolean;
  includeInNetWorth: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Transaction - Income and expenses
export type TransactionType = 'income' | 'expense' | 'transfer';

export interface RecurringConfig {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  interval: number; // e.g., every 2 weeks
  startDate: ISODateString;
  endDate?: ISODateString;
  lastProcessed?: ISODateString;
}

export interface Transaction {
  id: UUID;
  accountId: UUID;
  toAccountId?: UUID; // For transfers
  activityId?: UUID; // Link transaction to an activity
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  date: ISODateString;
  description: string;
  recurring?: RecurringConfig;
  recurringItemId?: UUID; // Links to source RecurringItem if auto-generated
  isReconciled: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// RecurringItem - Template for generating recurring transactions
export type RecurringFrequency = 'daily' | 'monthly' | 'yearly';

export interface RecurringItem {
  id: UUID;
  accountId: UUID; // Links to Account (and thus FamilyMember)
  type: 'income' | 'expense';
  amount: number;
  currency: CurrencyCode;
  category: string;
  description: string;
  frequency: RecurringFrequency;
  dayOfMonth: number; // 1-28 for monthly/yearly
  monthOfYear?: number; // 1-12, only for yearly frequency
  startDate: ISODateString;
  endDate?: ISODateString;
  lastProcessedDate?: ISODateString;
  isActive: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Asset - Property, vehicles, valuables
export type AssetType =
  | 'real_estate'
  | 'vehicle'
  | 'boat'
  | 'jewelry'
  | 'electronics'
  | 'equipment'
  | 'art'
  | 'collectible'
  | 'other';

// Loan details for assets with financing
export interface AssetLoan {
  hasLoan: boolean;
  loanAmount?: number; // Original principal
  outstandingBalance?: number; // Current amount owed
  interestRate?: number; // Annual percentage
  monthlyPayment?: number;
  loanTermMonths?: number;
  lender?: string;
  lenderCountry?: string;
  loanStartDate?: ISODateString;
}

export interface Asset {
  id: UUID;
  memberId: UUID;
  type: AssetType;
  name: string;
  purchaseValue: number;
  currentValue: number;
  purchaseDate?: ISODateString;
  currency: CurrencyCode;
  notes?: string;
  includeInNetWorth: boolean;
  loan?: AssetLoan;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Goal - Savings targets
export type GoalType = 'savings' | 'debt_payoff' | 'investment' | 'purchase';
export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Goal {
  id: UUID;
  memberId?: UUID; // null = family-wide goal
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  currency: CurrencyCode;
  deadline?: ISODateString;
  priority: GoalPriority;
  isCompleted: boolean;
  notes?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Budget - Monthly spending plan
export type BudgetMode = 'percentage' | 'fixed';

export interface BudgetCategory {
  categoryId: string; // references EXPENSE_CATEGORIES[].id
  amount: number; // planned monthly amount
}

export interface Budget {
  id: UUID;
  memberId?: UUID; // null = family-wide budget
  mode: BudgetMode;
  totalAmount: number; // for fixed: the cap; for percentage: calculated
  percentage?: number; // only for percentage mode (e.g., 68 = 68%)
  currency: CurrencyCode;
  categories: BudgetCategory[];
  isActive: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Todo item - Family task management
export interface TodoItem {
  id: UUID;
  title: string;
  description?: string;
  assigneeId?: UUID; // FK to FamilyMember (who should do it)
  dueDate?: ISODateString; // ISO date (no time = untimed task)
  dueTime?: string; // HH:mm
  completed: boolean;
  completedBy?: UUID; // FK to FamilyMember
  completedAt?: ISODateString;
  createdBy: UUID; // FK to FamilyMember
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateTodoInput = Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateTodoInput = Partial<Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>>;

// Family Activity — The Treehouse planner's central entity
export type ActivityCategory = 'lesson' | 'sport' | 'appointment' | 'social' | 'pickup' | 'other';
export type ActivityRecurrence = 'weekly' | 'daily' | 'monthly' | 'yearly' | 'none';
export type FeeSchedule = 'none' | 'per_session' | 'weekly' | 'monthly' | 'termly' | 'yearly';
export type ReminderMinutes = 0 | 5 | 10 | 15 | 30 | 60 | 120 | 1440;

export interface FamilyActivity {
  id: UUID;
  title: string;
  description?: string;
  icon?: string; // Emoji icon (e.g. "⚽")

  // Schedule
  date: ISODateString; // Start date / next occurrence
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  recurrence: ActivityRecurrence;
  daysOfWeek?: number[]; // Multi-day weekly recurrence (0=Sun..6=Sat)

  // Category
  category: ActivityCategory;
  color?: string; // Per-activity highlight color override (falls back to category color)

  // People
  assigneeId?: UUID; // The child/member doing the activity
  dropoffMemberId?: UUID; // Who drops off
  pickupMemberId?: UUID; // Who picks up

  // Location
  location?: string;

  // Fees
  feeSchedule: FeeSchedule;
  feeAmount?: number;
  feeCurrency?: CurrencyCode;
  feePayerId?: UUID;

  // Instructor / Coach
  instructorName?: string;
  instructorContact?: string;

  // Reminders
  reminderMinutes: ReminderMinutes;

  // Notes
  notes?: string;

  // Metadata
  isActive: boolean;
  createdBy: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateFamilyActivityInput = Omit<FamilyActivity, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateFamilyActivityInput = Partial<
  Omit<FamilyActivity, 'id' | 'createdAt' | 'updatedAt'>
>;

// Exchange rate for currency conversion
export interface ExchangeRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  updatedAt: ISODateString;
}

// AI Provider configuration
export type AIProvider = 'claude' | 'openai' | 'gemini' | 'none';

export interface AIApiKeys {
  claude?: string;
  openai?: string;
  gemini?: string;
}

// Settings - App configuration
export interface Settings {
  id: 'app_settings';
  baseCurrency: CurrencyCode;
  displayCurrency: CurrencyCode; // Currency for displaying all values (can differ from base)
  exchangeRates: ExchangeRate[];
  exchangeRateAutoUpdate: boolean;
  exchangeRateLastFetch: ISODateString | null;
  theme: 'light' | 'dark' | 'system';
  language: LanguageCode;
  syncEnabled: boolean;
  syncFilePath?: string; // Display name of sync file
  autoSyncEnabled: boolean;
  encryptionEnabled: boolean;
  lastSyncTimestamp?: ISODateString;
  aiProvider: AIProvider;
  aiApiKeys: AIApiKeys;
  preferredCurrencies?: CurrencyCode[];
  customInstitutions?: string[];
  onboardingCompleted?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Translation cache entry for storing translations in IndexedDB
export interface TranslationCacheEntry {
  id: string; // Compound: `${key}:${language}`
  key: string;
  language: LanguageCode;
  translation: string;
  version: number; // Legacy: no longer used, kept for backward compatibility
  hash?: string; // Hash of source text, used to detect when translation is outdated
}

// Sync queue item for tracking changes
export type SyncOperation = 'create' | 'update' | 'delete';
export type EntityType =
  | 'familyMember'
  | 'account'
  | 'transaction'
  | 'asset'
  | 'goal'
  | 'budget'
  | 'recurringItem'
  | 'todo'
  | 'familyActivity'
  | 'settings';

export interface SyncQueueItem {
  id: UUID;
  entityType: EntityType;
  entityId: UUID;
  operation: SyncOperation;
  data?: Record<string, unknown>;
  timestamp: ISODateString;
  synced: boolean;
}

// Google Auth state
export interface GoogleAuthState {
  isAuthenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: ISODateString;
  userEmail?: string;
}

// Category definitions for income and expenses
export interface Category {
  id: string;
  name: string;
  icon: string;
  type: 'income' | 'expense' | 'both';
  color: string;
  group?: string;
}

// Form types for creating/updating entities
export type CreateFamilyMemberInput = Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateFamilyMemberInput = Partial<Omit<FamilyMember, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateAccountInput = Omit<Account, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAccountInput = Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateTransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateTransactionInput = Partial<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateAssetInput = Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAssetInput = Partial<Omit<Asset, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateGoalInput = Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateGoalInput = Partial<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateBudgetInput = Omit<Budget, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateBudgetInput = Partial<Omit<Budget, 'id' | 'createdAt' | 'updatedAt'>>;

export type CreateRecurringItemInput = Omit<RecurringItem, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateRecurringItemInput = Partial<
  Omit<RecurringItem, 'id' | 'createdAt' | 'updatedAt'>
>;

// Deletion tombstone for merge-based sync
export interface DeletionTombstone {
  id: UUID;
  entityType: EntityType;
  deletedAt: ISODateString;
}

// Sync file format
export const SYNC_FILE_VERSION = '3.0';

export interface SyncFileData {
  version: string;
  exportedAt: ISODateString;
  encrypted: boolean;
  familyId?: UUID; // v2.0: identifies which family this data belongs to
  familyName?: string; // v2.0: human-readable family name
  data: {
    familyMembers: FamilyMember[];
    accounts: Account[];
    transactions: Transaction[];
    assets: Asset[];
    goals: Goal[];
    recurringItems: RecurringItem[];
    todos?: TodoItem[];
    activities?: FamilyActivity[];
    budgets?: Budget[];
    deletions: DeletionTombstone[];
    settings: Settings | null;
  };
}

export interface SyncStatus {
  isConfigured: boolean;
  fileName: string | null;
  lastSync: ISODateString | null;
  isSyncing: boolean;
  error: string | null;
}

// Family registry — maps familyId to file location metadata
export interface RegistryEntry {
  familyId: UUID;
  provider: 'local' | 'google_drive';
  fileId?: string | null; // Google Drive file ID (future)
  displayPath?: string | null;
  familyName?: string | null;
  updatedAt: ISODateString;
}
