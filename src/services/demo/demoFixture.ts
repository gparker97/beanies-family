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
  FamilyActivity,
  FamilyMember,
  Goal,
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
      color: '#E67E22',
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
      color: '#AED6F1',
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
      color: '#2C3E50',
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
      color: '#F15D22',
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

  return { familyMembers: members, accounts, transactions, goals, assets, activities, todos };
}
