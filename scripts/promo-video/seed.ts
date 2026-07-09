/**
 * Synthetic family used for the store promo recording.
 *
 * Wholly fictional. Nothing here touches Google Drive, the registry, or a real
 * `.beanpod` — it is written straight into the in-memory Automerge doc via
 * `window.__e2eDataBridge.seedData()` (DEV-only).
 *
 * Dates are computed relative to "today" so the nook and planner always look
 * lived-in on the day the video is recorded.
 */
import { TestDataFactory } from '../../e2e/fixtures/data';
import type { ExportedData } from '../../e2e/helpers/indexeddb';
import type { TodoItem } from '../../src/types/models';

const iso = (d: Date) => d.toISOString().split('T')[0];
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * @param ownerId id of the owner the create-a-family flow already made. We
 * overwrite that record rather than adding a fourth member, otherwise the
 * harness's placeholder ("John Doe") shows up in the bean pod on camera.
 */
export function buildDemoFamily(ownerId: string): Partial<ExportedData> {
  const now = new Date().toISOString();

  const john = TestDataFactory.createFamilyMember({
    id: ownerId,
    name: 'John Bean',
    email: 'john@thebeanfamily.example',
    role: 'owner',
    color: '#2C3E50',
  });
  const mary = TestDataFactory.createFamilyMember({
    name: 'Mary Bean',
    email: 'mary@thebeanfamily.example',
    role: 'admin',
    color: '#E67E22',
  });
  const neily = TestDataFactory.createFamilyMember({
    name: 'Neily Bean',
    email: 'neily@thebeanfamily.example',
    role: 'member',
    color: '#F15D22',
  });

  const checking = TestDataFactory.createAccount(john.id, {
    name: 'Everyday',
    type: 'checking',
    balance: 4820,
    institution: 'Bean Bank',
  });
  const savings = TestDataFactory.createAccount(mary.id, {
    name: 'Rainy Day',
    type: 'savings',
    balance: 12400,
    institution: 'Bean Bank',
  });

  const transactions = [
    { d: 0, desc: 'Grocery run', amount: 84.2, category: 'groceries' },
    { d: -1, desc: 'Swimming lessons', amount: 60, category: 'education' },
    { d: -2, desc: 'Coffee', amount: 5.4, category: 'dining' },
    { d: -3, desc: 'Electricity', amount: 132.5, category: 'utilities' },
    { d: -4, desc: 'Farmers market', amount: 46.8, category: 'groceries' },
  ].map((t) =>
    TestDataFactory.createTransaction(checking.id, {
      description: t.desc,
      amount: t.amount,
      category: t.category,
      date: iso(shift(t.d)),
      type: 'expense',
    })
  );

  const activities = [
    TestDataFactory.createActivity(john.id, {
      title: 'Wolf camp',
      icon: '🏕️',
      date: iso(shift(0)),
      startTime: '08:45',
      endTime: '14:45',
      recurrence: 'none',
      daysOfWeek: undefined,
      category: 'sports',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Piano lesson',
      icon: '🎹',
      date: iso(shift(1)),
      startTime: '16:00',
      endTime: '17:00',
      category: 'piano',
    }),
    TestDataFactory.createActivity(john.id, {
      title: 'Family dinner',
      icon: '🍝',
      date: iso(shift(2)),
      startTime: '18:30',
      endTime: '20:00',
      recurrence: 'none',
      daysOfWeek: undefined,
      category: 'other',
    }),
  ];

  const todo = (title: string, o: Partial<TodoItem> = {}): TodoItem => ({
    id: `todo-${title.replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    completed: false,
    createdBy: john.id,
    createdAt: now,
    updatedAt: now,
    ...o,
  });

  const todos = [
    todo('Pack swimwear for wolf camp', { assigneeIds: [john.id], dueDate: iso(shift(0)) }),
    todo('Book the dentist', { assigneeIds: [mary.id], dueDate: iso(shift(3)) }),
    todo('Renew passports', { assigneeIds: [mary.id], someday: true }),
    todo('Water the beanstalk', { assigneeIds: [neily.id], dueDate: iso(shift(0)) }),
  ];

  return {
    familyMembers: [john, mary, neily],
    accounts: [checking, savings],
    transactions,
    activities,
    todos,
    settings: TestDataFactory.createSettings({ baseCurrency: 'SGD', displayCurrency: 'SGD' }),
  };
}
