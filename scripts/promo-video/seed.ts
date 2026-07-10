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

  // Every bean has already joined. BeanCard shows an amber "waiting to join" badge
  // whenever `member.requiresPassword` is truthy — and that field is DERIVED on read
  // (`familyMemberRepository`: `requiresPassword: !member.passwordHash`), so seeding
  // `requiresPassword: false` is silently overwritten. Give them a passwordHash
  // instead. Nothing authenticates against it: the harness signs in via the
  // `e2e_auto_auth` bypass against an in-memory provider.
  const joined = { passwordHash: 'demo-seed-not-a-real-hash', requiresPassword: false };

  const john = TestDataFactory.createFamilyMember({
    id: ownerId,
    name: 'John Bean',
    email: 'john@thebeanfamily.example',
    role: 'owner',
    color: '#2C3E50',
    ...joined,
  });
  const mary = TestDataFactory.createFamilyMember({
    name: 'Mary Bean',
    email: 'mary@thebeanfamily.example',
    role: 'admin',
    color: '#E67E22',
    ...joined,
  });
  const neily = TestDataFactory.createFamilyMember({
    name: 'Neily Bean',
    email: 'neily@thebeanfamily.example',
    role: 'member',
    color: '#F15D22',
    ...joined,
  });

  // Accounts are created FOUR MONTHS ago on purpose. `netWorthHistory` treats an
  // account's opening balance as a change on its `createdAt` date and reconstructs
  // history by walking backwards from today — so an account created "today" makes
  // net worth exactly 0 at the start of every chart window, and the hero card's
  // percent change divides by that zero (the take showed "+5222708551936642048.0%
  // this month"). Backdating gives the family a real baseline and a believable line.
  const opened = iso(shift(-120));
  const checking = TestDataFactory.createAccount(john.id, {
    name: 'Everyday',
    type: 'checking',
    balance: 4820,
    institution: 'Bean Bank',
    createdAt: opened,
  });
  const savings = TestDataFactory.createAccount(mary.id, {
    name: 'Rainy Day',
    type: 'savings',
    balance: 12400,
    institution: 'Bean Bank',
    createdAt: opened,
  });

  // Two salaries inside the 1M window keep the chart trending gently UP; the
  // day-to-day expenses give the line some texture.
  const transactions = [
    { d: 0, desc: 'Grocery run', amount: 84.2, category: 'groceries', type: 'expense' as const },
    {
      d: -1,
      desc: 'Swimming lessons',
      amount: 60,
      category: 'education',
      type: 'expense' as const,
    },
    { d: -2, desc: 'Coffee', amount: 5.4, category: 'dining', type: 'expense' as const },
    { d: -3, desc: 'Electricity', amount: 132.5, category: 'utilities', type: 'expense' as const },
    {
      d: -4,
      desc: 'Farmers market',
      amount: 46.8,
      category: 'groceries',
      type: 'expense' as const,
    },
    { d: -12, desc: 'Salary', amount: 3200, category: 'salary', type: 'income' as const },
    { d: -26, desc: 'Salary', amount: 3200, category: 'salary', type: 'income' as const },
  ].map((t) =>
    TestDataFactory.createTransaction(checking.id, {
      description: t.desc,
      amount: t.amount,
      category: t.category,
      date: iso(shift(t.d)),
      type: t.type,
    })
  );

  // EVERY activity must pin `recurrence: 'none'` + `daysOfWeek: undefined`.
  // `TestDataFactory.createActivity` defaults to `recurrence: 'weekly'` with
  // `daysOfWeek: [today's weekday]`, so an activity that omits them silently
  // becomes a weekly event on today's weekday and never renders on its own date
  // (Piano lesson was invisible in the planner for exactly this reason).
  const oneOff = { recurrence: 'none' as const, daysOfWeek: undefined };

  const activities = [
    TestDataFactory.createActivity(john.id, {
      title: 'Wolf camp',
      icon: '🏕️',
      date: iso(shift(0)),
      startTime: '08:45',
      endTime: '14:45',
      ...oneOff,
      category: 'sports',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Piano lesson',
      icon: '🎹',
      date: iso(shift(1)),
      startTime: '16:00',
      endTime: '17:00',
      ...oneOff,
      category: 'piano',
    }),
    TestDataFactory.createActivity(john.id, {
      title: 'Family dinner',
      icon: '🍝',
      date: iso(shift(2)),
      startTime: '18:30',
      endTime: '20:00',
      ...oneOff,
      category: 'other',
    }),
    // A lived-in fortnight. With only three activities the planner reads as a wall
    // of "nothing planned", which is a poor listing shot and poor footage.
    TestDataFactory.createActivity(neily.id, {
      title: 'Swimming lesson',
      icon: '🏊',
      date: iso(shift(3)),
      startTime: '09:30',
      endTime: '10:30',
      ...oneOff,
      category: 'sports',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Dentist',
      icon: '🦷',
      date: iso(shift(4)),
      startTime: '11:00',
      endTime: '11:45',
      ...oneOff,
      category: 'medical',
    }),
    TestDataFactory.createActivity(john.id, {
      title: 'Football practice',
      icon: '⚽',
      date: iso(shift(5)),
      startTime: '17:00',
      endTime: '18:30',
      ...oneOff,
      category: 'sports',
    }),
    TestDataFactory.createActivity(neily.id, {
      title: 'Movie night',
      icon: '🍿',
      date: iso(shift(6)),
      startTime: '19:00',
      endTime: '21:00',
      ...oneOff,
      category: 'other',
    }),
    TestDataFactory.createActivity(mary.id, {
      title: 'Grandma visits',
      icon: '👵',
      date: iso(shift(8)),
      startTime: '14:00',
      endTime: '17:00',
      ...oneOff,
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
