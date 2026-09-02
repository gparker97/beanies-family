/**
 * REVIEW-DEMO: the synthetic family a store reviewer sees. TEMPORARY — see the
 * retirement checklist in `docs/runbooks/native-store-submission.md`.
 *
 * PURE DATA + one pure materializer. No logic beyond resolving dates relative to
 * "today" and wiring in the runtime owner id. If this file ever needs a branch,
 * something has gone wrong with the design — go back to
 * `docs/plans/2026-08-20-app-review-demo-mode.md`.
 *
 * Typed against the real models, so a model change is a COMPILE error here rather
 * than a reviewer staring at a half-rendered page. That is the entire reason this
 * is a TS fixture and not a pre-built `.beanpod` committed to the repo: an
 * encrypted blob stops decrypting the moment the envelope or schema moves, and
 * fails as "wrong password" with no clue why.
 *
 * EVERY value here is invented. Emails are `@example.invalid` (RFC 2606 — cannot
 * resolve), names and amounts are made up, and nothing resembles a real account.
 *
 * CURRENCY: everything is USD deliberately, matching `DEFAULT_CURRENCY` — the
 * base currency a freshly-created pod already has. Any other currency would make
 * the app fetch live exchange rates to render the amounts, and demo mode
 * guarantees zero network calls (verified in the browser walkthrough: setting a
 * non-default base currency fired a request to the currency-rates CDN).
 */

import type {
  Account,
  Asset,
  Budget,
  FamilyActivity,
  FamilyList,
  FamilyMember,
  FamilyVacation,
  Goal,
  Medication,
  Milestone,
  RecurringItem,
  SayingItem,
  TodoItem,
  Transaction,
  UUID,
} from '@/types/models';
import type { FamilyDocument } from '@/types/automerge';

/**
 * What the fixture hands to `seedDocument`: collections as ARRAYS of whole
 * entities, keyed by collection name.
 *
 * Deliberately not `Partial<FamilyDocument>` — the document stores each
 * collection as a `Record<string, Entity>`, and `seedDocument` is what turns
 * these arrays into keyed `set` ops. Declaring the document type here would be
 * a quietly false description of the value (this tsconfig happens to accept the
 * assignment, which is exactly why it is worth being explicit).
 *
 * Keying on `keyof FamilyDocument` keeps the compile-time link: a typo'd or
 * removed collection name fails here.
 */
export type DemoFixture = Partial<Record<keyof FamilyDocument, unknown>>;

/**
 * Stable ids. Fixed rather than generated so the fixture is deterministic and a
 * failing assertion points at a nameable record. They are namespaced `demo-` so
 * they are instantly recognisable in a doc dump or a bug report.
 */
const ID = {
  partner: 'demo-member-partner',
  kidA: 'demo-member-kid-a',
  kidB: 'demo-member-kid-b',
  kidC: 'demo-member-kid-c',
  current: 'demo-account-current',
  savings: 'demo-account-savings',
  kidsSavings: 'demo-account-kids-savings',
  card: 'demo-account-card',
} as const;

/** `today` shifted by whole days, as an ISO date (YYYY-MM-DD). */
function dayOffset(today: Date, days: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full ISO timestamp for `createdAt` / `updatedAt`, offset in whole days. */
function stampOffset(today: Date, days: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Build the demo family's entities for a given day and owner.
 *
 * PURE: the same `{ today, ownerMemberId }` always produces identical output.
 *
 * `ownerMemberId` is threaded in because the owner's id is minted at runtime by
 * `authStore.signUp` and cannot be known when this file is authored — the
 * fixture's accounts, transactions, activities and to-dos all need to reference
 * the person the reviewer is signed in as, or the pod looks like it belongs to
 * strangers.
 *
 * CRITICAL: this deliberately emits NO `familyMembers` entry for the owner.
 * `signUp` already wrote that row, including its `passwordHash`, and a `{ op:
 * 'set' }` with the same id would overwrite it wholesale — locking the demo
 * session out of its own pod.
 */
export function materializeFixture(args: { today: Date; ownerMemberId: UUID }): DemoFixture {
  const { today, ownerMemberId } = args;
  const created = stampOffset(today, -120);

  const members: FamilyMember[] = [
    {
      id: ID.partner,
      name: 'Sam',
      email: 'sam@example.invalid',
      gender: 'female',
      ageGroup: 'adult',
      role: 'admin',
      color: '#8b5cf6',
      requiresPassword: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.kidA,
      name: 'Rosa',
      email: 'rosa@example.invalid',
      gender: 'female',
      ageGroup: 'child',
      role: 'member',
      color: '#22c55e',
      requiresPassword: false,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.kidB,
      name: 'Milo',
      email: 'milo@example.invalid',
      gender: 'male',
      ageGroup: 'child',
      role: 'member',
      color: '#f59e0b',
      requiresPassword: false,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.kidC,
      name: 'Ada',
      email: 'ada@example.invalid',
      gender: 'female',
      ageGroup: 'child',
      role: 'member',
      color: '#ec4899',
      requiresPassword: false,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // Balances are stated outright: the batch write bypasses the stores, so
  // nothing recalculates them from the transactions below. They are chosen to
  // look plausible against those transactions, not derived from them.
  const accounts: Account[] = [
    {
      id: ID.current,
      memberId: ownerMemberId,
      coOwnerIds: [ID.partner],
      name: 'Everyday Account',
      icon: '🏦',
      type: 'checking',
      currency: 'USD',
      balance: 3240.55,
      institution: 'Beanstalk Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.savings,
      memberId: ownerMemberId,
      coOwnerIds: [ID.partner],
      name: 'Rainy Day Pot',
      icon: '☔',
      type: 'savings',
      currency: 'USD',
      balance: 11750,
      institution: 'Beanstalk Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.kidsSavings,
      memberId: ID.partner,
      forMemberIds: [ID.kidA, ID.kidB, ID.kidC],
      name: 'Little Beans Savings',
      icon: '🫘',
      type: 'savings',
      currency: 'USD',
      balance: 2410,
      institution: 'Beanstalk Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: ID.card,
      memberId: ownerMemberId,
      name: 'Everyday Card',
      icon: '💳',
      type: 'credit_card',
      currency: 'USD',
      balance: -640.2,
      institution: 'Beanstalk Bank',
      isActive: true,
      includeInNetWorth: true,
      createdAt: created,
      updatedAt: created,
    },
  ];

  /** Compact transaction builder — keeps the list below readable. */
  const tx = (
    n: number,
    dayAgo: number,
    accountId: UUID,
    type: Transaction['type'],
    amount: number,
    category: string,
    description: string
  ): Transaction => ({
    id: `demo-tx-${n}`,
    accountId,
    type,
    amount,
    currency: 'USD',
    category,
    date: dayOffset(today, -dayAgo),
    description,
    isReconciled: false,
    createdAt: stampOffset(today, -dayAgo),
    updatedAt: stampOffset(today, -dayAgo),
  });

  const transactions: Transaction[] = [
    tx(1, 2, ID.current, 'expense', 82.4, 'groceries', 'Weekly shop'),
    tx(2, 3, ID.card, 'expense', 12.8, 'coffee', 'Saturday flat whites'),
    tx(3, 4, ID.current, 'expense', 46, 'dining_out', 'Pizza night'),
    tx(4, 5, ID.current, 'expense', 28.5, 'gas', 'Fuel'),
    tx(5, 6, ID.current, 'expense', 35, 'music_lessons', "Rosa's piano lesson"),
    tx(6, 7, ID.current, 'income', 3200, 'salary', 'Monthly salary'),
    tx(7, 8, ID.current, 'expense', 74.15, 'groceries', 'Weekly shop'),
    tx(8, 9, ID.card, 'expense', 18.99, 'streaming', 'Family streaming plan'),
    tx(9, 11, ID.current, 'expense', 145, 'utilities', 'Electricity + gas'),
    tx(10, 12, ID.current, 'expense', 60, 'sports_team', "Milo's football subs"),
    tx(11, 13, ID.card, 'expense', 42.3, 'clothing', 'School shoes'),
    tx(12, 14, ID.current, 'expense', 88.2, 'groceries', 'Weekly shop'),
    tx(13, 16, ID.current, 'expense', 25, 'dance_lessons', "Ada's ballet class"),
    tx(14, 18, ID.savings, 'income', 400, 'other_income', 'Monthly transfer to savings'),
    tx(15, 19, ID.current, 'expense', 91.05, 'groceries', 'Weekly shop'),
    tx(16, 21, ID.card, 'expense', 34.6, 'entertainment', 'Cinema trip'),
    tx(17, 23, ID.current, 'expense', 210, 'childcare', 'After-school club'),
    tx(18, 25, ID.current, 'expense', 67.4, 'groceries', 'Weekly shop'),
    tx(19, 27, ID.current, 'expense', 15.5, 'public_transit', 'Travel card top-up'),
    tx(20, 29, ID.current, 'expense', 120, 'insurance', 'Home insurance'),
    tx(21, 32, ID.current, 'expense', 79.9, 'groceries', 'Weekly shop'),
    tx(22, 35, ID.card, 'expense', 55, 'gifts_given', "Birthday present for Rosa's friend"),
    tx(23, 37, ID.current, 'income', 3200, 'salary', 'Monthly salary'),
    tx(24, 39, ID.current, 'expense', 43.2, 'car_maintenance', 'Tyre replacement'),
    tx(25, 41, ID.current, 'expense', 86.7, 'groceries', 'Weekly shop'),
    tx(26, 44, ID.kidsSavings, 'income', 150, 'gifts', 'Pocket money savings'),
    tx(27, 47, ID.current, 'expense', 32, 'dental', 'Check-up'),
    tx(28, 50, ID.current, 'expense', 94.15, 'groceries', 'Weekly shop'),
    tx(29, 54, ID.card, 'expense', 27.4, 'hobbies', 'Craft supplies'),
    tx(30, 58, ID.current, 'expense', 165, 'school_fees', 'Term trip contribution'),
  ];

  const goals: Goal[] = [
    {
      id: 'demo-goal-holiday',
      memberId: null,
      name: 'Summer by the Sea',
      type: 'vacation',
      targetAmount: 4000,
      currentAmount: 2350,
      currency: 'USD',
      deadline: dayOffset(today, 210),
      priority: 'high',
      isCompleted: false,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-goal-emergency',
      memberId: null,
      name: 'Emergency Fund',
      type: 'emergency',
      targetAmount: 12000,
      currentAmount: 9400,
      currency: 'USD',
      priority: 'critical',
      isCompleted: false,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-goal-bikes',
      memberId: ID.kidB,
      name: 'New Bike for Milo',
      type: 'purchase',
      targetAmount: 300,
      currentAmount: 300,
      currency: 'USD',
      priority: 'low',
      isCompleted: true,
      createdAt: created,
      updatedAt: created,
    },
  ];

  const assets: Asset[] = [
    {
      id: 'demo-asset-car',
      memberId: ownerMemberId,
      type: 'vehicle',
      name: 'Family Estate Car',
      purchaseValue: 18500,
      currentValue: 12200,
      purchaseDate: dayOffset(today, -1100),
      currency: 'USD',
      includeInNetWorth: true,
      createdAt: created,
      updatedAt: created,
    },
  ];

  /** Compact activity builder — every demo activity is a simple dated event. */
  const act = (
    n: number,
    dayFromNow: number,
    title: string,
    icon: string,
    category: FamilyActivity['category'],
    startTime: string,
    endTime: string,
    assigneeIds: UUID[],
    location: string
  ): FamilyActivity => ({
    id: `demo-activity-${n}`,
    title,
    icon,
    date: dayOffset(today, dayFromNow),
    startTime,
    endTime,
    recurrence: 'none',
    category,
    assigneeIds,
    dropoffMemberId: ownerMemberId,
    pickupMemberId: ID.partner,
    location,
    feeSchedule: 'none',
    reminderMinutes: 30,
    isActive: true,
    createdBy: ownerMemberId,
    createdAt: created,
    updatedAt: created,
  });

  const activities: FamilyActivity[] = [
    act(1, 0, 'Piano Lesson', '🎹', 'music', '16:30', '17:15', [ID.kidA], 'Bramble Music School'),
    act(2, 1, 'Football Training', '⚽', 'football', '17:00', '18:30', [ID.kidB], 'Meadow Park'),
    act(3, 2, 'Ballet Class', '🩰', 'dance', '15:45', '16:45', [ID.kidC], 'Corner Studio'),
    act(4, 3, 'Swimming', '🏊', 'swimming', '09:00', '10:00', [ID.kidA, ID.kidB], 'Lido Pool'),
    act(
      5,
      4,
      'Parents Evening',
      '🏫',
      'other_school',
      '18:00',
      '19:00',
      [ID.kidA],
      'Hillside School'
    ),
    act(6, 5, 'Birthday Party', '🎂', 'birthday', '14:00', '16:30', [ID.kidC], 'Willow Hall'),
    act(
      7,
      6,
      'Library Trip',
      '📚',
      'other_educational',
      '11:00',
      '12:00',
      [ID.kidA, ID.kidB, ID.kidC],
      'Town Library'
    ),
    // The trip's all-day calendar span. A real trip is created via
    // vacationStore.createVacation, which mints exactly this shape: an all-day,
    // multi-day 'other_activity' back-linked to the vacation via `vacationId`.
    {
      id: 'demo-activity-trip',
      title: 'Seaside Getaway',
      icon: '🏖️',
      date: dayOffset(today, 30),
      endDate: dayOffset(today, 34),
      isAllDay: true,
      recurrence: 'none',
      category: 'other_activity',
      assigneeIds: [ownerMemberId, ID.partner, ID.kidA, ID.kidB, ID.kidC],
      location: 'Seaside',
      feeSchedule: 'none',
      reminderMinutes: 1440,
      isActive: true,
      createdBy: ownerMemberId,
      vacationId: 'demo-vacation-seaside',
      createdAt: created,
      updatedAt: created,
    },
  ];

  const todos: TodoItem[] = [
    {
      id: 'demo-todo-1',
      title: 'Pack swimming kit',
      assigneeIds: [ownerMemberId],
      dueDate: dayOffset(today, 2),
      completed: false,
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-todo-2',
      title: 'Buy birthday present',
      description: 'Something craft-y — Ada said glitter.',
      assigneeIds: [ID.partner],
      dueDate: dayOffset(today, 4),
      completed: false,
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-todo-3',
      title: 'Renew library cards',
      assigneeIds: [ownerMemberId],
      dueDate: dayOffset(today, 6),
      completed: false,
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-todo-4',
      title: 'Book dentist check-up',
      assigneeIds: [ID.partner],
      dueDate: dayOffset(today, 9),
      completed: false,
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-todo-5',
      title: 'Send school trip form',
      assigneeIds: [ownerMemberId],
      dueDate: dayOffset(today, -1),
      completed: true,
      completedBy: ownerMemberId,
      completedAt: stampOffset(today, -1),
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // Recurring money items — the templates the forecast projects forward. All
  // dayOfMonth ≤ 28 (the model's ceiling, so they land every month). The savings
  // item links to the emergency-fund goal so goal auto-funding shows on the page.
  const recurringItems: RecurringItem[] = [
    {
      id: 'demo-recurring-salary',
      accountId: ID.current,
      type: 'income',
      amount: 3200,
      currency: 'USD',
      category: 'salary',
      description: 'Monthly salary',
      frequency: 'monthly',
      dayOfMonth: 25,
      startDate: dayOffset(today, -120),
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-recurring-rent',
      accountId: ID.current,
      type: 'expense',
      amount: 1450,
      currency: 'USD',
      category: 'rent',
      description: 'Rent',
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: dayOffset(today, -120),
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-recurring-utilities',
      accountId: ID.current,
      type: 'expense',
      amount: 145,
      currency: 'USD',
      category: 'utilities',
      description: 'Electricity + gas',
      frequency: 'monthly',
      dayOfMonth: 11,
      startDate: dayOffset(today, -120),
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-recurring-streaming',
      accountId: ID.card,
      type: 'expense',
      amount: 18.99,
      currency: 'USD',
      category: 'streaming',
      description: 'Family streaming plan',
      frequency: 'monthly',
      dayOfMonth: 8,
      startDate: dayOffset(today, -120),
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'demo-recurring-savings',
      accountId: ID.current,
      type: 'expense',
      amount: 250,
      currency: 'USD',
      category: 'other_financial',
      description: 'Monthly savings',
      frequency: 'monthly',
      dayOfMonth: 26,
      startDate: dayOffset(today, -120),
      goalId: 'demo-goal-emergency',
      goalAllocMode: 'fixed',
      goalAllocValue: 250,
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // Family-wide monthly budget: a 20% target, with per-category line items.
  const budgets: Budget[] = [
    {
      id: 'demo-budget-family',
      mode: 'percentage',
      totalAmount: 640,
      percentage: 20,
      currency: 'USD',
      categories: [
        { categoryId: 'groceries', amount: 320 },
        { categoryId: 'dining_out', amount: 60 },
        { categoryId: 'utilities', amount: 145 },
        { categoryId: 'streaming', amount: 19 },
        { categoryId: 'music_lessons', amount: 35 },
        { categoryId: 'clothing', amount: 61 },
      ],
      isActive: true,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // A travel plan: the FamilyVacation half of the 'demo-activity-trip' pairing
  // above. Two flight legs, a hotel, an airport shuttle and a couple of ideas —
  // the same structure vacationStore.createVacation produces.
  const vacations: FamilyVacation[] = [
    {
      id: 'demo-vacation-seaside',
      activityId: 'demo-activity-trip',
      name: 'Seaside Getaway',
      tripType: 'fly_and_stay',
      tripPurpose: 'vacation',
      assigneeIds: [ownerMemberId, ID.partner, ID.kidA, ID.kidB, ID.kidC],
      travelSegments: [
        {
          id: 'demo-seg-flight-out',
          type: 'flight_outbound',
          title: 'Flight to the coast',
          status: 'booked',
          airline: 'Beanstalk Air',
          flightNumber: 'BN220',
          departureAirport: 'Home City',
          arrivalAirport: 'Seaside',
          departureDate: dayOffset(today, 30),
          departureTime: '09:15',
          arrivalDate: dayOffset(today, 30),
          arrivalTime: '11:30',
          bookingReference: 'BNSTLK1',
        },
        {
          id: 'demo-seg-flight-return',
          type: 'flight_return',
          title: 'Flight home',
          status: 'booked',
          airline: 'Beanstalk Air',
          flightNumber: 'BN221',
          departureAirport: 'Seaside',
          arrivalAirport: 'Home City',
          departureDate: dayOffset(today, 34),
          departureTime: '18:00',
          arrivalDate: dayOffset(today, 34),
          arrivalTime: '20:10',
          bookingReference: 'BNSTLK1',
        },
      ],
      accommodations: [
        {
          id: 'demo-acc-hotel',
          type: 'hotel',
          title: 'Seaview Family Hotel',
          status: 'booked',
          name: 'Seaview Family Hotel',
          address: '1 Shoreline Road, Seaside',
          checkInDate: dayOffset(today, 30),
          checkOutDate: dayOffset(today, 34),
          confirmationNumber: 'HTL-8842',
          roomType: 'Family room (2 adults, 3 children)',
          breakfastIncluded: true,
        },
      ],
      transportation: [
        {
          id: 'demo-trans-shuttle',
          type: 'airport_shuttle',
          title: 'Airport shuttle',
          status: 'pending',
        },
      ],
      ideas: [
        {
          id: 'demo-idea-sandcastle',
          title: 'Sandcastle competition on the beach',
          category: 'beach',
          costType: 'free',
          votes: [],
          createdBy: ownerMemberId,
          createdAt: created,
        },
        {
          id: 'demo-idea-aquarium',
          title: 'Visit the Seaside Aquarium',
          category: 'activity',
          costType: 'paid',
          estimatedCost: 48,
          estimatedCostCurrency: 'USD',
          needsBooking: true,
          votes: [],
          createdBy: ownerMemberId,
          createdAt: created,
        },
      ],
      startDate: dayOffset(today, 30),
      endDate: dayOffset(today, 34),
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // Care & Safety: one ongoing daily medication for a child.
  const medications: Medication[] = [
    {
      id: 'demo-medication-1',
      memberId: ID.kidA,
      name: 'Antihistamine',
      dose: '5 ml',
      frequency: 'once daily',
      dosesPerDay: 1,
      ongoing: true,
      startDate: dayOffset(today, -60),
      notes: 'Hay-fever season — with breakfast.',
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // Scrapbook: a quotable family saying, and a milestone.
  const sayings: SayingItem[] = [
    {
      id: 'demo-saying-1',
      memberId: ID.kidC,
      words: 'Beans are just tiny grown-ups.',
      saidOn: dayOffset(today, -12),
      place: 'At the dinner table',
      context: 'When asked what beans are.',
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  const milestones: Milestone[] = [
    {
      id: 'demo-milestone-1',
      memberId: ID.kidB,
      category: 'lost_tooth',
      title: 'Milo lost his first tooth',
      occurredOn: dayOffset(today, -20),
      description: 'Wobbly all week — finally out at breakfast.',
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // A beanie list — a named family checklist (recurring weekly).
  const lists: FamilyList[] = [
    {
      id: 'demo-list-groceries',
      title: 'Weekly Groceries',
      emoji: '🛒',
      category: 'home',
      ownerId: ownerMemberId,
      items: [
        { id: 'demo-list-item-1', title: 'Milk', completed: true, completedBy: ownerMemberId },
        { id: 'demo-list-item-2', title: 'Bread', completed: true, completedBy: ID.partner },
        { id: 'demo-list-item-3', title: 'Bananas', completed: false },
        { id: 'demo-list-item-4', title: 'Pasta', completed: false },
        { id: 'demo-list-item-5', title: 'Washing-up liquid', completed: false },
      ],
      lifecycle: 'recurring',
      frequency: 'weekly',
      completed: false,
      createdBy: ownerMemberId,
      createdAt: created,
      updatedAt: created,
    },
  ];

  return {
    familyMembers: members,
    accounts,
    transactions,
    recurringItems,
    budgets,
    goals,
    assets,
    activities,
    vacations,
    todos,
    lists,
    medications,
    sayings,
    milestones,
  };
}
