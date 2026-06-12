// Type aliases for clarity
export type UUID = string;
export type ISODateString = string;
/**
 * Full ISO-8601 datetime string (e.g. `2026-04-21T14:32:11.000Z`).
 * Distinct from ISODateString for self-documentation where hour/minute
 * precision is load-bearing — medication log entries, for example.
 */
export type ISODateTimeString = string;
export type CurrencyCode = string; // ISO 4217 codes (e.g., 'USD', 'EUR', 'GBP')
export type LanguageCode = 'en' | 'zh'; // Supported UI languages
export type CountryCode = string; // ISO 3166-1 alpha-2, uppercase (e.g., 'SG', 'US', 'GB')

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
  memberId: UUID; // FK to FamilyMember in per-family DB
  lastActiveAt: ISODateString;
}

// GlobalSettings - Device-level settings (stored in registry DB, not per-family)
export interface GlobalSettings {
  id: 'global_settings';
  theme: 'light' | 'dark' | 'system';
  language: LanguageCode;
  textSize?: 'normal' | 'large';
  lastActiveFamilyId: UUID | null;
  exchangeRates: ExchangeRate[];
  exchangeRateAutoUpdate: boolean;
  exchangeRateLastFetch: ISODateString | null;
  beanieMode?: boolean;
  soundEnabled?: boolean;
  beanieLabEnabled?: boolean; // per-device opt-in to experimental features (The Beanie Lab); off by default, never family-synced
  isTrustedDevice?: boolean;
  trustedDevicePromptShown?: boolean;
  cachedFamilyKeys?: Record<string, string>;
  passkeyPromptShown?: boolean;
  country?: CountryCode; // device mirror of Settings.country (dual-persisted, like language) — drives public-holiday display
}

// PasskeyRegistration - Stored in registry DB (survives sign-out)
export interface PasskeyRegistration {
  credentialId: string; // base64url credential ID (keyPath)
  memberId: UUID; // FK to FamilyMember
  familyId: UUID; // FK to Family
  publicKey: string; // base64 public key
  transports?: string[]; // AuthenticatorTransport hints
  prfSupported: boolean; // PRF available during registration?
  label: string; // e.g. "MacBook Touch ID"
  createdAt: ISODateString;
  lastUsedAt?: ISODateString;
}

// PasskeySecret - PRF-wrapped family key stored in .beanpod envelope
export interface PasskeySecret {
  credentialId: string; // Which passkey credential created this
  memberId: UUID; // Which member this belongs to
  wrappedFamilyKey: string; // AES-KW wrapped family key
  hkdfSalt: string; // HKDF salt (base64)
  createdAt: ISODateString;
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
  /**
   * Alternate names this member is known by — chiefly the legal/full name(s) as written on
   * travel documents (e.g. "Jonathan Smith" for a member named "Johnny"). Used to match
   * AI-extracted itinerary passenger names to the right member, and learned automatically when
   * the user confirms a mapping in the travel-extract review. Stored normalized (see
   * `normalizePersonName`). Local-only — never transmitted. Absent = none.
   */
  aliases?: string[];
  /**
   * User-editable contact email. May be any address the user wants
   * displayed for this member; not required to match any specific
   * external account. Distinct from `googleAccountEmail`, which is
   * the OAuth-bound identity used for Google Drive sync.
   */
  email: string;
  /**
   * The Google account email this member is bound to for Drive sync.
   *
   * Set automatically the first time the member's own OAuth completes
   * successfully. Read-only via normal forms — to change, use the
   * explicit "switch Google account" flow in Settings, which forces a
   * fresh consent screen and updates this field only after the new
   * consent succeeds.
   *
   * NEVER overwritten silently. May be undefined for members created
   * before this field was introduced; backfilled lazily on each
   * member's own next successful token acquisition. Until then,
   * account assertion is skipped (fail-open) for that member.
   *
   * Distinct from `email` — see ADR / 2026-04-26 plan for the
   * two-email design rationale.
   */
  googleAccountEmail?: string;
  avatar?: string;
  /**
   * Optional user-uploaded avatar photo — takes precedence over `avatar`
   * (beanie variant) when set. Beanie variant remains the always-available
   * fallback path (missing / loading / unresolved). Added 2026-04 with The Pod.
   */
  avatarPhotoId?: UUID;
  gender: Gender;
  ageGroup: AgeGroup;
  dateOfBirth?: DateOfBirth;
  role: 'owner' | 'admin' | 'member';
  canViewFinances?: boolean;
  canEditActivities?: boolean;
  canManagePod?: boolean;
  color: string; // UI differentiation
  passwordHash?: string; // PBKDF2 hash in "salt:hash" format
  requiresPassword: boolean; // true when member needs to set a password
  lastLoginAt?: ISODateString;
  /**
   * True when this member is a pet. Pets count in the family roster and
   * can have favorites, allergies, and medications, but never receive an
   * invite, own permissions, or need a password. Added 2026-04.
   */
  isPet?: boolean;
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
  | 'retirement_401k'
  | 'retirement_ira'
  | 'retirement_roth_ira'
  | 'retirement_bene_ira'
  | 'retirement_kids_ira'
  | 'retirement'
  | 'education_529'
  | 'education_savings'
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
  linkedAssetId?: UUID; // Links a loan account to its source asset
  interestRate?: number; // Annual interest rate (loan accounts only)
  monthlyPayment?: number; // Monthly payment amount (loan accounts only)
  loanTermMonths?: number; // Loan term in months (loan accounts only)
  loanStartDate?: ISODateString; // Loan start date (loan accounts only)
  payFromAccountId?: UUID; // Account to pay from for linked recurring payment
  linkedRecurringItemId?: UUID; // Auto-created recurring payment item
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Transaction - Income and expenses
export type TransactionType = 'income' | 'expense' | 'transfer' | 'balance_adjustment';

export interface RecurringConfig {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  interval: number; // e.g., every 2 weeks
  startDate: ISODateString;
  endDate?: ISODateString;
  lastProcessed?: ISODateString;
}

/** Metadata attached to `balance_adjustment` transactions. Never set for other types. */
export interface BalanceAdjustmentMeta {
  delta: number; // signed; positive = credit, negative = debit
  updatedBy: UUID; // FamilyMember.id who initiated the adjustment
}

export interface Transaction {
  id: UUID;
  accountId: UUID;
  toAccountId?: UUID; // For transfers
  activityId?: UUID; // Link transaction to an activity
  loanId?: UUID; // Link transaction to an asset loan (by asset ID) or loan account (by account ID)
  loanInterestPortion?: number; // Interest portion from amortization calculation
  loanPrincipalPortion?: number; // Principal portion from amortization calculation
  goalId?: UUID; // Link transaction to a goal for progress tracking
  goalAllocMode?: 'percentage' | 'fixed'; // How to compute allocation
  goalAllocValue?: number; // 20 for 20%, or 200 for $200 fixed
  goalAllocApplied?: number; // Actual amount credited to goal (after guardrail)
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  date: ISODateString;
  description: string;
  recurring?: RecurringConfig;
  recurringItemId?: UUID; // Links to source RecurringItem if auto-generated
  adjustment?: BalanceAdjustmentMeta; // only set when type === 'balance_adjustment'
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
  goalId?: UUID; // Link to a goal for progress tracking
  goalAllocMode?: 'percentage' | 'fixed'; // How to compute allocation
  goalAllocValue?: number; // 20 for 20%, or 200 for $200 fixed
  loanId?: UUID; // Link to an asset loan or loan account for auto-amortization
  activityId?: UUID; // Link to a family activity for fee tracking
  lastProcessedDate?: ISODateString;
  isActive: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Display transaction — extends Transaction with projection metadata for UI
export type DisplayTransaction = Transaction & { isProjected?: boolean };

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
  payFromAccountId?: UUID; // Account to pay from for linked recurring payment
  linkedRecurringItemId?: UUID; // Auto-created recurring payment item
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
export type GoalType =
  | 'savings'
  | 'debt_payoff'
  | 'investment'
  | 'purchase'
  | 'vacation'
  | 'vehicle'
  | 'home'
  | 'education'
  | 'emergency';
export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Goal {
  id: UUID;
  memberId?: UUID | null; // null = family-wide goal
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  currency: CurrencyCode;
  deadline?: ISODateString;
  priority: GoalPriority;
  isCompleted: boolean;
  notes?: string;
  manualContributions?: GoalManualContribution[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Append-only audit entries for user-initiated contributions to a goal
 * (quick-contribute modal, or `currentAmount` edits through GoalModal).
 * Automated contributions flow through Transaction rows with `goalId` set
 * and are NOT written here.
 */
export interface GoalManualContribution {
  id: UUID;
  amount: number; // signed: positive = progress, negative = reversal
  at: ISODateString; // full ISO timestamp
  updatedBy: UUID; // FamilyMember.id
  note?: string; // optional user-provided context
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
  /** @deprecated Use assigneeIds instead */
  assigneeId?: UUID;
  assigneeIds?: UUID[]; // FK to FamilyMember(s) — who should do it
  dueDate?: ISODateString; // ISO date (no time = untimed task)
  dueTime?: string; // HH:mm
  /** "Someday / maybe" — an open, deliberately unscheduled, no-commitment item. When true, dueDate/dueTime are cleared. */
  someday?: boolean;
  completed: boolean;
  completedBy?: UUID; // FK to FamilyMember
  completedAt?: ISODateString;
  createdBy: UUID; // FK to FamilyMember
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateTodoInput = Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateTodoInput = Partial<Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>>;

/** User-selectable sort order for the Family To-Do list (page-level). */
export type TodoSort = 'newest' | 'oldest' | 'dueDate';

// Family Activity — The Treehouse planner's central entity
//
// IMPORTANT: This union must stay in sync with ACTIVITY_CATEGORIES in
// src/constants/activityCategories.ts and the activityCategoryToExpenseCategory
// mapping in src/constants/categories.ts. See activityCategories.test.ts for
// the structural invariant tests that lock all three sources together.
export type ActivityCategory =
  // School
  | 'after_school'
  | 'field_trip'
  | 'school_recital'
  | 'other_school'
  // Educational
  | 'tutoring'
  | 'math'
  | 'language'
  | 'science'
  | 'other_educational'
  // Sports
  | 'tennis'
  | 'badminton'
  | 'golf_activity'
  | 'baseball'
  | 'gym_activity'
  | 'yoga_activity'
  | 'soccer'
  | 'football'
  | 'rugby'
  | 'multi_sport'
  | 'gymnastics'
  | 'mma'
  | 'taekwondo'
  | 'other_sports_activity'
  // Competitions
  | 'spelling_bee'
  | 'math_competition'
  | 'cubing'
  | 'other_competition'
  // Lessons
  | 'piano'
  | 'guitar'
  | 'trumpet'
  | 'drum'
  | 'music'
  | 'art'
  | 'dance'
  | 'swimming'
  | 'other_lesson'
  // Entertainment
  | 'movie'
  | 'show'
  | 'concert'
  | 'theme_park'
  | 'sporting_event'
  | 'museum'
  | 'festival'
  | 'other_entertainment'
  // Food
  | 'brunch'
  | 'coffee'
  | 'dining_out'
  | 'drinks'
  | 'picnic'
  | 'other_food'
  // Party
  | 'birthday'
  | 'wedding'
  | 'bar_mitzvah'
  | 'other_celebration'
  // Appointments
  | 'doctor'
  | 'dentist'
  | 'eye_exam'
  | 'haircut'
  | 'other_appointment'
  // Other
  | 'other_activity';
/**
 * Recurrence rule for a `FamilyActivity`.
 *
 * The rule is fully determined by THIS enum value plus the activity's
 * `date`, `daysOfWeek` (weekly only), and `recurrenceEndDate`. There
 * are NO hidden anchor fields — anything else (day-of-month for `'monthly'`,
 * nth-weekday + day-of-week for `'monthly-by-day'`) is derived from
 * `date` at occurrence-generation time. If you need an anchor that
 * differs from what `date` implies, change the start date or the
 * recurrence kind; don't add a new field.
 *
 * For `'monthly-by-day'`: the nth-weekday anchor is `ceil(startDate.getDate() / 7)`,
 * coerced to `-1` ("last weekday of month") when that would be 5 — so an
 * activity starting on the 5th Wednesday of its month becomes "last Wednesday
 * of every month". Matches Google Calendar's behaviour; produces an
 * occurrence in every month (vs. silently skipping months with only 4
 * Wednesdays).
 *
 * For `'biweekly'`: single day-of-week anchored to `date`, step 14 days.
 * Multi-day biweekly ("every other Mon + Wed") is intentionally not supported
 * — `daysOfWeek` is ignored for this kind.
 */
export type ActivityRecurrence =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'monthly-by-day'
  | 'yearly';
export type FeeSchedule =
  | 'none'
  | 'per_session'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'custom'
  | 'all'
  | 'termly'; // @deprecated — legacy, treated as monthly passthrough
export type ReminderMinutes = 0 | 5 | 10 | 15 | 30 | 60 | 120 | 1440;

export interface DutyCompletion {
  date: string; // occurrence date (ISO date string)
  completedBy: UUID; // member who completed
  completedAt: ISODateString; // timestamp of completion
}

export interface FamilyActivity {
  id: UUID;
  title: string;
  description?: string;
  icon?: string; // Emoji icon (e.g. "⚽")

  // Schedule
  date: ISODateString; // Start date / next occurrence
  endDate?: ISODateString; // End date for multi-day all-day activities
  isAllDay?: boolean; // All-day activity (no specific times)
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  recurrence: ActivityRecurrence;
  daysOfWeek?: number[]; // Multi-day weekly recurrence (0=Sun..6=Sat)
  recurrenceEndDate?: ISODateString; // Optional end date for recurring activities
  parentActivityId?: UUID; // Links one-off override to its recurring parent
  originalOccurrenceDate?: ISODateString; // Original date this override replaces (for rescheduling)

  // Category
  category: ActivityCategory;
  color?: string; // Per-activity highlight color override (falls back to category color)

  // People
  /** @deprecated Use assigneeIds instead */
  assigneeId?: UUID;
  assigneeIds?: UUID[]; // The child/member(s) doing the activity
  dropoffMemberId?: UUID; // Who drops off
  pickupMemberId?: UUID; // Who picks up

  // Location
  location?: string;

  // Fees
  feeSchedule: FeeSchedule;
  feeAmount?: number;
  feeCurrency?: CurrencyCode;
  feeCustomPeriod?: number; // e.g. 6 for "every 6 weeks" (custom schedule only)
  feeCustomPeriodUnit?: 'weeks' | 'months'; // unit for custom period
  /** @deprecated Use payFromAccountId instead — the account's memberId identifies the payer */
  feePayerId?: UUID;
  payFromAccountId?: UUID; // Account to pay from for linked recurring payment
  linkedRecurringItemId?: UUID; // Auto-created recurring payment item

  // Instructor / Coach
  instructorName?: string;
  instructorContact?: string;

  // Reminders
  reminderMinutes: ReminderMinutes;

  // Duty completion tracking (per-occurrence for recurring activities)
  dropoffCompletions?: DutyCompletion[];
  pickupCompletions?: DutyCompletion[];

  // Notes
  notes?: string;

  // Photos — birthday invites, items-to-bring screenshots, location maps,
  // anything visual the user wants pinned to this calendar entry. Same
  // shape as Milestone / Medication / Recipe / CookLogEntry photoIds;
  // photoStore GC sweeps unreferenced photos via the 'activities'
  // collection registration in App.vue.
  photoIds?: UUID[];

  // Metadata
  isActive: boolean;
  createdBy: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;

  // Vacation link (set when this activity is auto-created as a vacation calendar entry)
  vacationId?: UUID;
}

export type CreateFamilyActivityInput = Omit<FamilyActivity, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateFamilyActivityInput = Partial<
  Omit<FamilyActivity, 'id' | 'createdAt' | 'updatedAt'>
>;

// ---------------------------------------------------------------------------
// Google Calendar Integration (#32) — one-way push of activities to external calendars
// ---------------------------------------------------------------------------

export type CalendarProvider = 'google';

export type CalendarConnectionStatus = 'ok' | 'needs_reconnect' | 'error' | 'disconnecting';

/**
 * A connected external calendar (family-wide). Stored in the CRDT so every
 * family device shares the connection AND its refresh token — so any device can
 * keep the calendar fresh, and the token survives a local-storage clear. The
 * refresh token is the connecter's own Google credential (family-trust boundary;
 * the `.beanpod` is already AES-256-GCM encrypted). See the #32 plan, Layer 2.
 */
export interface CalendarConnection {
  id: UUID;
  provider: CalendarProvider;
  accountEmail: string;
  /** Destination calendar id within the account. 'primary' by default. */
  destinationCalendarId: string;
  /** Long-lived OAuth refresh token (lives in the encrypted .beanpod). */
  refreshToken: string;
  /** Scopes actually granted (granular consent can drop some, e.g. freebusy / calendarlist). */
  grantedScopes: string[];
  status: CalendarConnectionStatus;
  /** ISO timestamp of the last reconcile that wrote/confirmed events. */
  lastSyncedAt?: ISODateString;
  /** Cross-device freshness-claim: when / by which device this was last reconciled. */
  lastReconciledAt?: ISODateString;
  lastReconciledBy?: string;
  /** Last classified error (for the Settings status line). */
  lastError?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateCalendarConnectionInput = Omit<
  CalendarConnection,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateCalendarConnectionInput = Partial<
  Omit<CalendarConnection, 'id' | 'createdAt' | 'updatedAt'>
>;

/**
 * Maps a beanies activity to the Google event beanies created for it within a
 * connection. Lives in the CRDT → shared across devices; with the deterministic
 * event id this yields cross-device dedup. `id` is the composite
 * `${connectionId}:${activityId}` so lookups are O(1) and creation is idempotent.
 */
export interface CalendarEventLink {
  id: UUID; // composite `${connectionId}:${activityId}`
  connectionId: UUID;
  activityId: UUID;
  googleEventId: string;
  /** Hash of the pushed-relevant activity fields; skip reconcile when unchanged. */
  lastPushedHash: string;
  lastPushedAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateCalendarEventLinkInput = Omit<
  CalendarEventLink,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateCalendarEventLinkInput = Partial<
  Omit<CalendarEventLink, 'id' | 'createdAt' | 'updatedAt'>
>;

export type DriveProvider = 'google';

/**
 * A Google Drive refresh token stored in the encrypted `.beanpod` as a RECOVERY
 * copy (see `driveTokenRecovery.ts`). Keyed in the doc by `driveConnectionId(email)`
 * = the normalized account email.
 *
 * UNLIKE `CalendarConnection`, this is **per-account, NOT family-wide**: each
 * member authenticates Drive as themselves, so a token for account A must never
 * be used by a device acting as account B. The local IndexedDB store
 * (`fileHandleStore`) remains the PRIMARY token home; this doc copy is purely
 * additive — it lets a lost local token self-heal across the same Google
 * account's devices and turns many forced-consent reconnects into silent ones.
 * The `.beanpod` is already AES-256-GCM encrypted (family-trust boundary), same
 * as the calendar token.
 */
export interface DriveConnection {
  id: UUID; // driveConnectionId(accountEmail) — the normalized account email
  provider: DriveProvider;
  accountEmail: string;
  /** Long-lived OAuth refresh token (lives in the encrypted .beanpod). */
  refreshToken: string;
  /** When the stored refresh token was issued (ms epoch); newer wins on reconcile. */
  issuedAt: number | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateDriveConnectionInput = Omit<DriveConnection, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateDriveConnectionInput = Partial<
  Omit<DriveConnection, 'id' | 'createdAt' | 'updatedAt'>
>;

/**
 * Family-shared "we acknowledged this calendar overlap" record (#34). When a
 * family member taps "This is OK" on a clash, we remember it for the whole family
 * (lives in the CRDT → syncs across devices). Keyed in the doc by
 * `overlapAckKey(activityId, occurrenceDate, connectionId)` — exactly one entry
 * per (activity, occurrence, connection). The `fingerprint` (the activity
 * occurrence's own time window at ack time) is the value, not part of the key: if
 * the activity is later rescheduled the fingerprint mismatches → the overlap
 * re-raises, and a re-ack overwrites the same key (so the set stays bounded).
 * Never stores any external-event identity — only times ever cross the wire.
 */
export interface OverlapAck {
  activityId: string;
  /** `YYYY-MM-DD` of the acknowledged occurrence. */
  occurrenceDate: string;
  connectionId: string;
  /** Activity occurrence time window at ack time, `${startMs}-${endMs}`. */
  fingerprint: string;
  acknowledgedAt: ISODateString;
  /** memberId of whoever said "this is OK". */
  acknowledgedBy: string;
}

// ---------------------------------------------------------------------------
// Vacation Planning
// ---------------------------------------------------------------------------

export type VacationTripType =
  | 'fly_and_stay'
  | 'cruise'
  | 'road_trip'
  | 'combo'
  | 'camping'
  | 'adventure';

export type VacationSegmentStatus = 'booked' | 'pending';

export type VacationIdeaCategory =
  | 'beach'
  | 'activity'
  | 'food'
  | 'sightseeing'
  | 'shopping'
  | 'nightlife'
  | 'other';

export type VacationTravelType =
  | 'flight_outbound'
  | 'flight_return'
  | 'flight_other'
  | 'cruise'
  | 'train'
  | 'ferry'
  | 'car'
  | 'activity';

export type VacationActivityCategory =
  | 'show_musical'
  | 'theme_park'
  | 'sporting_event'
  | 'concert'
  | 'excursion'
  | 'other';

export type VacationAccommodationType = 'hotel' | 'airbnb' | 'campground' | 'family_friends';

export type VacationTransportationType =
  | 'airport_shuttle'
  | 'rental_car'
  | 'taxi_rideshare'
  | 'bus';

export interface VacationTravelSegment {
  id: UUID;
  type: VacationTravelType;
  title: string;
  status: VacationSegmentStatus;
  sortDate?: ISODateString;
  bookingReference?: string;
  notes?: string;

  // Flight fields
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  departureDate?: ISODateString;
  departureTime?: string;
  arrivalDate?: ISODateString;
  arrivalTime?: string;
  arrivesNextDay?: boolean;

  // Departure terminal — shared by flights ("Terminal 1") and cruises ("Cruise Terminal A").
  terminal?: string;

  // Return flight fields (used in combined flight entry, split on save)
  returnAirline?: string;
  returnFlightNumber?: string;
  returnDepartureAirport?: string;
  returnArrivalAirport?: string;
  returnDepartureDate?: ISODateString;
  returnDepartureTime?: string;
  returnArrivalDate?: ISODateString;
  returnArrivalTime?: string;
  returnBookingReference?: string;

  // Cruise fields
  cruiseLine?: string;
  shipName?: string;
  departurePort?: string;
  cabinNumber?: string;
  embarkationDate?: ISODateString;
  embarkationTime?: string;
  disembarkationDate?: ISODateString;

  // Train/Ferry fields
  operator?: string;
  route?: string;
  departureStation?: string;
  arrivalStation?: string;

  // Car fields
  carType?: 'family_car' | 'rental_car' | 'other';
  carLabel?: string;
  leavingTime?: string;

  // Common optional
  link?: string;

  // Activity fields
  activityCategory?: VacationActivityCategory;
  description?: string;
  location?: string;
  startTime?: string;
  duration?: string;

  // Attached booking documents — images/PDFs of the original itinerary
  // (references into doc.photos; see PhotoAttachment). Same shape as
  // FamilyActivity.photoIds.
  photoIds?: UUID[];

  // Family members on THIS segment. Undefined = the whole trip (FamilyVacation.assigneeIds).
  travellerIds?: UUID[];
}

export interface VacationAccommodation {
  id: UUID;
  type: VacationAccommodationType;
  title: string;
  status: VacationSegmentStatus;
  name?: string;
  address?: string;
  checkInDate?: ISODateString;
  checkOutDate?: ISODateString;
  confirmationNumber?: string;
  roomType?: string;
  contactPhone?: string;
  breakfastIncluded?: boolean;
  link?: string;
  notes?: string;

  // Attached booking documents — see VacationTravelSegment.photoIds.
  photoIds?: UUID[];

  // Family members on THIS segment. Undefined = the whole trip (FamilyVacation.assigneeIds).
  travellerIds?: UUID[];
}

export interface VacationTransportation {
  id: UUID;
  type: VacationTransportationType;
  title: string;
  status: VacationSegmentStatus;
  bookingReference?: string;
  pickupDate?: ISODateString;
  pickupTime?: string;
  returnDate?: ISODateString;
  returnTime?: string;
  agencyName?: string;
  agencyAddress?: string;
  // Train/Bus fields
  operator?: string;
  route?: string;
  departureStation?: string;
  arrivalStation?: string;
  departureDate?: ISODateString;
  departureTime?: string;
  link?: string;
  notes?: string;

  // Attached booking documents — see VacationTravelSegment.photoIds.
  photoIds?: UUID[];

  // Family members on THIS segment. Undefined = the whole trip (FamilyVacation.assigneeIds).
  travellerIds?: UUID[];
}

export interface VacationIdeaVote {
  memberId: UUID;
  votedAt: ISODateString;
}

export interface VacationIdea {
  id: UUID;
  title: string;
  description?: string;
  category?: VacationIdeaCategory;
  location?: string;
  suggestedDate?: ISODateString;
  estimatedCost?: number;
  estimatedCostCurrency?: CurrencyCode;
  costType?: 'free' | 'paid';
  duration?: '30min' | '1hr' | '2hrs' | 'half_day' | 'full_day';
  needsBooking?: boolean;
  isPlanned?: boolean;
  isSkipped?: boolean;
  link?: string;
  linkPreview?: {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
  };
  notes?: string;
  votes: VacationIdeaVote[];
  createdBy: UUID;
  createdAt: ISODateString;
}

export type VacationTripPurpose = 'vacation' | 'business';

export interface FamilyVacation {
  id: UUID;
  activityId: UUID; // Linked FamilyActivity for calendar display
  name: string;
  tripType: VacationTripType;
  tripPurpose?: VacationTripPurpose;
  assigneeIds: UUID[];

  travelSegments: VacationTravelSegment[];
  accommodations: VacationAccommodation[];
  transportation: VacationTransportation[];
  ideas: VacationIdea[];

  // User-owned trip window (ADR-023). Set at wizard Step 1, editable
  // on the trip summary page. Extended — never auto-shrunk — when
  // segments are added/edited with dates outside the window. Only
  // manual edits shrink. See `vacationStore.updateVacation` for the
  // auto-extend pipeline and `utils/vacation.ts::extendTripDates` for
  // the pure helper.
  startDate?: ISODateString;
  endDate?: ISODateString;

  createdBy: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateFamilyVacationInput = Omit<FamilyVacation, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateFamilyVacationInput = Partial<
  Omit<FamilyVacation, 'id' | 'createdAt' | 'updatedAt'>
>;

// Attachment substrate — metadata only; bytes live in the user's Google Drive app folder.
// The driveFileId is the canonical reference; thumbnailLink is looked up on demand
// via driveService.getFileMetadata and never persisted (signed URLs expire in hours).
//
// Despite the historical name, this record holds BOTH images and non-image
// documents (PDFs — travel booking attachments). For non-image attachments
// `width`/`height` are 0 and `fileName` carries the original filename. Branch
// on kind via `attachmentKind()` / `isPdf()` (src/utils/attachmentKind.ts) —
// never assume `mime` is an image. The name stays "Photo" for storage-compat
// (the `doc.photos` Automerge key + every existing call site); see
// docs/plans/2026-06-04-travel-segment-attachments.md.
export interface PhotoAttachment {
  id: UUID;
  driveFileId: string;
  mime: string;
  width: number; // 0 for non-raster attachments (PDFs)
  height: number; // 0 for non-raster attachments (PDFs)
  sizeBytes: number;
  fileName?: string; // original filename — set for PDFs; optional for images
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString; // tombstone for GC sweep
}

// ──────────────────────────────────────────────────────────────────
// The Pod — family scrapbook, cookbook, care & safety, contacts.
// See docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md.
// ──────────────────────────────────────────────────────────────────

export type FavoriteCategory = 'food' | 'place' | 'book' | 'song' | 'toy' | 'other';

/**
 * A favorite thing about a family member — foods, places, books, etc.
 * Food favorites may optionally link to a family cookbook recipe via
 * `recipeId`. For non-food entries (or ad-hoc food entries like
 * "McDonald's Happy Meal") the `name` field stands alone.
 */
export interface FavoriteItem {
  id: UUID;
  memberId: UUID;
  category: FavoriteCategory;
  name: string;
  description?: string;
  /** Only meaningful when category === 'food'. */
  recipeId?: UUID;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * A memorable quote or saying.
 * `memberId` is who said it; `aboutMemberId` (optional) lets us capture
 * things said ABOUT a member ("Sophia about Alice").
 */
export interface SayingItem {
  id: UUID;
  memberId: UUID;
  aboutMemberId?: UUID;
  words: string;
  /** When it was said (user-supplied date; may differ from createdAt). */
  saidOn?: ISODateString;
  place?: string;
  context?: string;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Free-form note about a family member — "shoe size", "calms down with…",
 * "allergies in backpack", etc.
 */
export interface MemberNote {
  id: UUID;
  memberId: UUID;
  title: string;
  body: string;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type AllergyType = 'food' | 'medication' | 'environmental' | 'contact' | 'insect';
export type AllergySeverity = 'severe' | 'moderate' | 'mild';

/**
 * An allergy — safety-critical. Captured with enough structure to be
 * shareable with sitters / grandparents.
 */
export interface Allergy {
  id: UUID;
  memberId: UUID;
  name: string;
  allergyType: AllergyType;
  severity: AllergySeverity;
  avoidList?: string;
  reaction?: string;
  emergencyResponse?: string;
  diagnosedBy?: string;
  reviewedOn?: ISODateString;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * A medication a family member is taking. v1: structured info only —
 * scheduled reminders land in a follow-up plan.
 */
export interface Medication {
  id: UUID;
  memberId: UUID;
  name: string;
  dose: string;
  /** Display-only string ("twice daily", "every 4 hours"). Auto-generated
   *  from `dosesPerDay` when 1-4; user-typed when `dosesPerDay` is null. */
  frequency: string;
  /**
   * Structured doses-per-day count for the daily reminder math in
   * `useCriticalItems`. `1`-`4` enables a reminder; `null` means
   * "as needed / other" — no reminder fires. Legacy records may have
   * this `undefined`; treat undefined the same as null at consumers.
   */
  dosesPerDay?: number | null;
  startDate?: ISODateString;
  endDate?: ISODateString;
  ongoing?: boolean;
  notes?: string;
  photoIds?: UUID[];
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * Administration log entry for a medication — "I gave a dose."
 *
 * Stores FULL timestamps (not just dates) because "last dose: 3h ago"
 * requires hour precision. A deleted medication cascade-removes all its
 * log entries (see `deleteMedication` in medicationsStore).
 *
 * Log entries are photo-less by design (v1) — no `registerPhotoCollection`
 * for this collection in App.vue. See plan 2026-04-21 §1.9.
 */
export interface MedicationLogEntry {
  id: UUID;
  medicationId: UUID;
  administeredOn: ISODateTimeString;
  administeredBy: UUID;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CreateMedicationLogEntryInput = Omit<
  MedicationLogEntry,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateMedicationLogEntryInput = Partial<CreateMedicationLogEntryInput>;

/**
 * A family milestone — a one-off life event captured for posterity. Lost a
 * tooth, first day of school, graduation, wedding, new home, etc.
 *
 * Per-member by default (`memberId` set). When `memberId` is null, the
 * milestone is family-wide ("we moved house", "first family vacation") —
 * no phantom "family bean" object; consumers key off the null check for
 * presentation.
 *
 * The category union is derived from `MILESTONE_CATEGORIES` in
 * `src/constants/milestoneCategories.ts` so adding a new category is one
 * edit. Unknown categories at read-time fall back to `'custom'` for
 * rendering with a one-time `reportError` per unknown category — see
 * the milestonesStore.
 */
export type MilestoneCategory =
  | 'birthday'
  | 'lost_tooth'
  | 'first_word'
  | 'first_step'
  | 'first_day_school'
  | 'graduation'
  | 'big_test'
  | 'recital'
  | 'big_win'
  | 'new_home'
  | 'new_job'
  | 'new_pet'
  | 'new_little_bean'
  | 'wedding'
  | 'anniversary'
  | 'big_trip'
  | 'license'
  | 'custom';

export interface Milestone {
  id: UUID;
  /** null = family-wide; non-null = single bean owner. */
  memberId: UUID | null;
  category: MilestoneCategory;
  /** User-visible title. Auto-fills from category default when empty; never overwrites a non-empty user-typed value. */
  title: string;
  /**
   * Date-only ISO string (YYYY-MM-DD). No time component — milestones are
   * day-anchored. Sorted lexically (ISO dates sort correctly as strings).
   * Don't store as a full datetime; timezone shifts could silently move a
   * milestone to the wrong day.
   */
  occurredOn: ISODateString;
  description?: string;
  photoIds?: UUID[];
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * A family recipe — "secret family recipe" in the Family Cookbook.
 * Family-wide; any member can link a `FavoriteItem` to it.
 */
export interface Recipe {
  id: UUID;
  name: string;
  subtitle?: string;
  prepTime?: string;
  servings?: string;
  ingredients: string[];
  steps: string[];
  notes?: string;
  photoIds?: UUID[];
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CookLogRating = 1 | 2 | 3 | 4 | 5;

/**
 * A log entry for a time a recipe was cooked. Family-wide; references
 * its recipe via `recipeId`. Deleting a recipe cascades its cook logs.
 */
export interface CookLogEntry {
  id: UUID;
  recipeId: UUID;
  cookedOn: ISODateString;
  cookedBy?: UUID;
  rating: CookLogRating;
  wentWell?: string;
  toImprove?: string;
  servings?: string;
  photoIds?: UUID[];
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type EmergencyContactCategory =
  | 'doctor'
  | 'dentist'
  | 'nurse'
  | 'teacher'
  | 'school'
  | 'other';

/**
 * An emergency / key contact — pediatrician, school, poison control,
 * backup pickup, etc. Family-wide. When `category === 'other'`, the
 * optional `customCategory` label gives the contact a meaningful tag.
 */
export interface EmergencyContact {
  id: UUID;
  category: EmergencyContactCategory;
  customCategory?: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdBy?: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

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

/**
 * Preference-ordered AI tiers (#133, ADR-030). Client settings hold the TIER
 * choice + BYOK keys only. The managed (Tinfoil) tier intentionally has NO
 * client-side key — it lives server-side in the ai-extract Lambda. That
 * separation IS the privacy boundary, not an unfinished feature; never store a
 * managed key in `AIApiKeys`.
 */
export type AiTier = 'managed' | 'byok' | 'on-device';

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
  textSize?: 'normal' | 'large';
  syncEnabled: boolean;
  syncFilePath?: string; // Display name of sync file
  autoSyncEnabled: boolean;
  encryptionEnabled: boolean;
  lastSyncTimestamp?: ISODateString;
  aiProvider: AIProvider;
  aiApiKeys: AIApiKeys;
  // #133: which AI tier processes documents. Optional because pre-existing family
  // docs predate the field — read it via settingsStore.aiTier (coalesces to 'managed').
  aiTier?: AiTier;
  preferredCurrencies?: CurrencyCode[];
  customInstitutions?: string[];
  onboardingCompleted?: boolean;
  weekStartDay?: 0 | 1; // 0=Sunday, 1=Monday (default: 1)
  country?: CountryCode; // family's country of residence — drives public-holiday display on the planner
  showPublicHolidays?: boolean; // default true once `country` is set; lets the family hide holidays
  skipDocumentConsentPrompt?: boolean; // #133: when true, the photo→activity AI consent modal is auto-confirmed (default: ask). Family-scoped.
  calendarClashNudgeEnabled?: boolean; // #34: warn when an activity clashes with a connected calendar's free/busy (default: true). Family-scoped.
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

// --- Public holidays (read-only reference data, bundled in public/holidays/<ISO2>.json) ---

// One holiday record as shipped in the per-country JSON file. `endDate` is
// reserved for multi-day holidays (v1 emits single-day records only); the
// runtime expansion handles it defensively if a future generator emits one.
export interface HolidayRecord {
  date: ISODateString; // YYYY-MM-DD (local date of the holiday)
  endDate?: ISODateString; // YYYY-MM-DD, inclusive — for multi-day holidays (reserved)
  name: string; // English name
  name_local?: string; // localized name in the country's primary language, when it differs
  type: 'public'; // v1 ships only public holidays; field kept so adding more types later is non-breaking
}

// Shape of public/holidays/<ISO2>.json.
export interface HolidayFile {
  meta: {
    country: CountryCode;
    name: string; // English country name
    generatedAt: ISODateString; // YYYY-MM-DD the data was last regenerated
    yearRange: [number, number]; // inclusive [firstYear, lastYear] the file covers
    source: string; // e.g. 'date-holidays@3.28.0'
    primaryLanguage: string; // ISO 639-1 lowercase
    types: ['public'];
  };
  holidays: HolidayRecord[];
}

// IndexedDB cache row for a country's holiday file (beanies-reference-data DB).
export interface HolidayCacheEntry {
  country: CountryCode; // keyPath
  generatedAt: ISODateString; // copied from the file's meta
  yearRange: [number, number];
  cachedAt: number; // Date.now() when written — drives the TTL
  holidays: HolidayRecord[];
}

// A holiday expanded to a single calendar date — what the planner views render.
export interface HolidayOccurrence {
  date: ISODateString; // YYYY-MM-DD
  name: string; // English name
  nameLocal?: string; // localized name, when present
  countryCode: CountryCode;
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
  createdAt?: ISODateString; // write-once, set server-side on first PUT
  ownerEmail?: string | null;
  subscribeNewsletter?: boolean | null;
  country?: CountryCode | null; // mirror of family Settings.country — denormalized for ops introspection
  updatedAt: ISODateString;
}
