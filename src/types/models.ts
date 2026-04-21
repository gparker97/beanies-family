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
  cachedFamilyKeys?: Record<string, string>;
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
  email: string;
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
  /** @deprecated Use assigneeIds instead */
  assigneeId?: UUID;
  assigneeIds?: UUID[]; // FK to FamilyMember(s) — who should do it
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
export type ActivityCategory =
  // School
  | 'after_school'
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
  // Fun
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
export type ActivityRecurrence = 'weekly' | 'daily' | 'monthly' | 'yearly' | 'none';
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

// Photo attachment — metadata only; bytes live in the user's Google Drive app folder.
// The driveFileId is the canonical reference; thumbnailLink is looked up on demand
// via driveService.getFileMetadata and never persisted (signed URLs expire in hours).
export interface PhotoAttachment {
  id: UUID;
  driveFileId: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
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
  frequency: string;
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
  weekStartDay?: 0 | 1; // 0=Sunday, 1=Monday (default: 1)
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
  updatedAt: ISODateString;
}
