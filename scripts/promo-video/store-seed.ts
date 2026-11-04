/**
 * The family for the App Store preview: the Play promo's synthetic family plus
 * the props the song asks for, all dated today. Every lyric in the preview is
 * answered by something on screen, and these are those somethings:
 *
 *   "dance recital at 9"        an activity at 09:00 for the girl
 *   "baseball at two-thirty"    an activity at 14:30 for the boy, dad picks up
 *   "clean your room / bed"     two to-dos due today, ticked on camera
 *   "did we pay the bills?"     the electricity bill, paid today
 *   "what's for dinner?"        tonight's dinner on the meal planner
 *   "beanies.family" (chorus)   the school-bag list with one item left to tick
 *
 * Wholly fictional, in-memory only (see `seed.ts`).
 */
import { TestDataFactory } from '../../e2e/fixtures/data';
import type { ExportedData } from '../../e2e/helpers/indexeddb';
import type { FamilyList, MealPlanEntry, TodoItem } from '../../src/types/models';
import { buildDemoFamily } from './seed';

const today = new Date().toISOString().split('T')[0]!;

/** The list the chorus ticks off. Every item but the last is already done. */
export const STORE_LIST_TITLE = 'School bag';
export const STORE_LIST_LAST_ITEM = 'Water bottle';
export const STORE_TODO_ROOM = 'Clean your room';
export const STORE_TODO_BED = 'Tidy your bed';
export const STORE_ACTIVITY_BASEBALL = 'Baseball';

export function buildStoreFamily(ownerId: string): Partial<ExportedData> {
  const base = buildDemoFamily(ownerId);
  const members = base.familyMembers!;
  const john = members.find((m) => m.id === ownerId)!;
  const mary = members.find((m) => m.name.startsWith('Mary'))!;
  const ansy = members.find((m) => m.name.startsWith('Ansy'))!;
  const lily = TestDataFactory.createFamilyMember({
    name: 'Lily Bean',
    email: 'lily@thebeanfamily.example',
    role: 'member',
    color: '#E8619A',
    passwordHash: 'demo-seed-not-a-real-hash',
    requiresPassword: false,
  });
  const now = new Date().toISOString();
  const oneOff = { recurrence: 'none' as const, daysOfWeek: undefined };

  const activities = [
    TestDataFactory.createActivity(mary.id, {
      title: 'Dance recital',
      icon: '🩰',
      date: today,
      startTime: '09:00',
      endTime: '10:30',
      ...oneOff,
      category: 'dance',
      assigneeIds: [lily.id],
      dropoffMemberId: mary.id,
      pickupMemberId: mary.id,
      color: lily.color,
    }),
    TestDataFactory.createActivity(john.id, {
      title: STORE_ACTIVITY_BASEBALL,
      icon: '⚾',
      date: today,
      startTime: '14:30',
      endTime: '16:00',
      ...oneOff,
      category: 'sports',
      assigneeIds: [ansy.id],
      dropoffMemberId: john.id,
      pickupMemberId: john.id,
      color: '#3D8BD4',
    }),
    ...base.activities!,
  ];

  const todo = (title: string, assignee: string): TodoItem => ({
    id: `todo-${title.replace(/\W+/g, '-').toLowerCase()}`,
    title,
    completed: false,
    createdBy: john.id,
    createdAt: now,
    updatedAt: now,
    assigneeIds: [assignee],
    dueDate: today,
  });
  const todos = [todo(STORE_TODO_ROOM, ansy.id), todo(STORE_TODO_BED, lily.id), ...base.todos!];

  const checking = base.accounts![0]!;
  const transactions = [
    TestDataFactory.createTransaction(checking.id, {
      type: 'expense',
      amount: 142.6,
      currency: checking.currency,
      category: 'utilities',
      date: today,
      description: 'Electricity bill',
      isReconciled: true,
    }),
    ...base.transactions!,
  ];

  const mealPlans: MealPlanEntry[] = [
    {
      id: 'meal-taco-night',
      date: today,
      slot: 'dinner',
      position: 1,
      kind: 'other',
      label: 'Taco night',
      cookMemberId: john.id,
      createdBy: john.id,
      createdAt: now,
      updatedAt: now,
    } as MealPlanEntry,
  ];

  const item = (title: string, completed: boolean) => ({
    id: `li-${title.replace(/\W+/g, '-').toLowerCase()}`,
    title,
    completed,
    ...(completed ? { completedBy: mary.id, completedAt: now } : {}),
  });
  const lists: FamilyList[] = [
    {
      id: 'list-school-bag',
      title: STORE_LIST_TITLE,
      emoji: '🎒',
      category: 'kids',
      ownerId: mary.id,
      items: [
        item('Gym kit', true),
        item('Reading book', true),
        item('Signed trip form', true),
        item(STORE_LIST_LAST_ITEM, false),
      ],
      lifecycle: 'oneoff',
      dueDate: today,
      completed: false,
      createdBy: mary.id,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    ...base,
    familyMembers: [...members, lily],
    activities,
    todos,
    transactions,
    mealPlans,
    lists,
  } as Partial<ExportedData>;
}
