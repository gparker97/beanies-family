// Shared test fixture (NOT a spec: no `.test` suffix). Data that makes EVERY known load-time
// writer want to write, for the snapshot-paint regression test and the read-only loader table.
import type { CollectionName } from '@/types/automerge';
import { addDaysYmd, localToday } from '@/utils/date';
import { choreMarkId } from '@/utils/chores';

const TS = '2020-01-01T00:00:00.000Z';
export const today = localToday();
const yesterday = addDaysYmd(today, -1);
const longAgo = addDaysYmd(today, -120);
const lastWeek = addDaysYmd(today, -7);

/**
 * Stars and rewards (#148) ON since long ago: with the kid, the chore and the tick below, the
 * stars week close wants to freeze every closable week. Seed it with
 * `mutate({ op: 'named', name: 'patchSettings', args: { patch: STAR_SETTINGS } })`.
 */
export const STAR_SETTINGS = {
  id: 'app_settings',
  choreRewards: { on: true, startedOn: '2020-01-01', weeklyOn: true, barPct: 100 },
} as const;

/** Everything a load-time writer wants to act on, with ids tagged by source. */
export function seedEntities(
  tag: 'auth' | 'snap'
): Array<[CollectionName, Record<string, unknown>]> {
  return [
    [
      'familyMembers',
      {
        id: 'owner',
        name: 'Owner',
        email: 'o@x',
        role: 'owner',
        color: '#000',
        passwordHash: 'h',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    // A legacy admin: the role heal migrates it to member + canManagePod.
    [
      'familyMembers',
      {
        id: `admin-${tag}`,
        name: 'Admin',
        email: `a-${tag}@x`,
        role: 'admin',
        color: '#111',
        passwordHash: 'h',
        createdAt: '2020-02-01T00:00:00.000Z',
        updatedAt: TS,
      },
    ],
    // A daily list last reset yesterday, ticked: the daily reset (and cycle archive) is due.
    [
      'lists',
      {
        id: `list-${tag}`,
        title: 'Chores',
        emoji: '🧹',
        category: 'home',
        ownerId: 'owner',
        lifecycle: 'recurring',
        frequency: 'daily',
        lastResetDate: yesterday,
        completed: false,
        items: [
          {
            id: 'i1',
            text: 'Sweep',
            completed: true,
            completedBy: 'owner',
            completedAt: `${yesterday}T10:00:00.000Z`,
            createdAt: TS,
          },
        ],
        createdBy: 'owner',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    // An overdue repeating to-do: the auto-roll is due.
    [
      'todos',
      {
        id: `todo-${tag}`,
        title: 'Bins',
        completed: false,
        createdBy: 'owner',
        dueDate: addDaysYmd(today, -30),
        repeat: {
          rule: { unit: 'week', interval: 1, end: { kind: 'never' } },
          anchor: addDaysYmd(today, -60),
        },
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    // A chore mark far past the keep window: the retention sweep is due.
    [
      'choreMarks',
      {
        id: choreMarkId('done', 'owner', longAgo, `c-${tag}`),
        kind: 'done',
        memberId: 'owner',
        date: longAgo,
        ref: `c-${tag}`,
        by: 'owner',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    // A kid with a daily chore ticked last week: with `STAR_SETTINGS`, the stars week close is due.
    [
      'familyMembers',
      {
        id: `kid-${tag}`,
        name: 'Kid',
        email: `k-${tag}@x`,
        role: 'member',
        ageGroup: 'child',
        color: '#222',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    [
      'chores',
      {
        id: `chore-${tag}`,
        title: 'Make bed',
        emoji: '🛏️',
        assigneeIds: [`kid-${tag}`],
        block: 'morning',
        sortOrder: 0,
        createdBy: 'owner',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    [
      'choreMarks',
      {
        id: choreMarkId('done', `kid-${tag}`, lastWeek, `chore-${tag}`),
        kind: 'done',
        memberId: `kid-${tag}`,
        date: lastWeek,
        ref: `chore-${tag}`,
        by: `kid-${tag}`,
        createdAt: `${lastWeek}T08:00:00.000Z`,
        updatedAt: `${lastWeek}T08:00:00.000Z`,
      },
    ],
    // An asset with a loan and no linked account: the linked-loan migration is due.
    [
      'assets',
      {
        id: `asset-${tag}`,
        memberId: 'owner',
        type: 'real_estate',
        name: `House ${tag}`,
        purchaseValue: 1,
        currentValue: 1,
        currency: 'USD',
        includeInNetWorth: true,
        loan: { hasLoan: true, outstandingBalance: 1000, lender: 'Bank' },
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  ];
}
