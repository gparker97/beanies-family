/**
 * The home-screen widget snapshot builder (#130). Local factories, no Pinia (the
 * `wallJobs.test.ts` shape).
 *
 * The fixture test is the cross-platform contract: `fixtures/widget-snapshot.v3.json` is the
 * builder's output for the mockup's family, and the Swift and Java readers use it as their
 * sample. Regenerate it ONLY on a deliberate schema or copy change, and review the diff:
 *
 *   UPDATE_WIDGET_FIXTURE=1 npx vitest run src/utils/__tests__/widgetSnapshot.test.ts
 *   npx prettier --write src/utils/__tests__/fixtures/widget-snapshot.v3.json
 *
 * `fixtures/widget-snapshot.v2.json` is frozen: the older shape the readers still accept
 * (readers take 2 and 3). A test below proves v3 only ADDED optional fields to it.
 *
 * (The comparison is on the parsed JSON, so Prettier's layout never fails the test.)
 *
 * The fixture is timezone-independent: epoch fields are stored as the local wall time read as
 * UTC (`normaliseEpochs`), so 10:15 on the 11th is `2026-10-11T10:15:00Z` on every machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/utils/shareableOrigin', () => ({
  shareableOrigin: () => 'https://app.beanies.family',
}));

import {
  buildWidgetSnapshot,
  MAX_WIDGET_TASKS,
  type WidgetSnapshotInput,
} from '@/utils/widgetSnapshot';
import { UI_STRINGS, type UIStringKey } from '@/services/translation/uiStrings';
import { computeInitials } from '@/utils/memberInitials';
import type { HintTodo } from '@/utils/helpfulHints';
import type { ActivityOccurrence } from '@/utils/calendar/occurrence';
import type {
  FamilyActivity,
  FamilyList,
  FamilyMember,
  FamilyVacation,
  MealPlanEntry,
  Recipe,
  TodoItem,
} from '@/types/models';
import {
  WIDGET_DAYS,
  WIDGET_SNAPSHOT_READABLE_VERSIONS,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetDay,
  type WidgetSnapshot,
} from '@/types/widgetSnapshot';
import type { WeatherReading } from '@/types/weather';
import { addDaysYmd } from '@/utils/date';
import { AGE_SHOW_MS, CURRENT_MAX_MS } from '@/utils/weather/weatherReading';

const FIXTURE = resolve(__dirname, 'fixtures/widget-snapshot.v3.json');
const FIXTURE_V2 = resolve(__dirname, 'fixtures/widget-snapshot.v2.json');
const ORIGIN = 'https://app.beanies.family';
// The mockup's "Saturday 11" is a Sunday in 2026; the date (and its numeral) is kept.
const TODAY = '2026-10-11';
const TOMORROW = '2026-10-12';
/** The look-ahead from `ymd`: the `days` the composable passes. */
const daysFrom = (ymd: string) => Array.from({ length: WIDGET_DAYS }, (_, i) => addDaysYmd(ymd, i));
/** `generatedAt` is a UTC instant so it reads the same on every machine. */
const NOW = new Date(Date.UTC(2026, 9, 11, 0, 40));

const t = (key: UIStringKey): string => UI_STRINGS[key];

// ── Factories ────────────────────────────────────────────────────────────────

function person(id: string, name: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name, role: 'member', ageGroup: 'adult', ...over } as FamilyMember;
}

const SAM = person('sam', 'Sam', { role: 'owner', gender: 'male', color: '#3b82f6' });
const JO = person('jo', 'Jo', {
  gender: 'female',
  color: '#ec4899',
  dateOfBirth: { year: 1988, month: 10, day: 16 },
});
const AVA = person('ava', 'Ava', {
  ageGroup: 'child',
  gender: 'female',
  color: '#8b5cf6',
  dateOfBirth: { year: 2017, month: 3, day: 14 },
});
const MAX = person('max', 'Max', {
  ageGroup: 'child',
  gender: 'male',
  color: '#22c55e',
  dateOfBirth: { year: 2019, month: 11, day: 1 },
});
const BISCUIT = person('biscuit', 'Biscuit', { isPet: true, ageGroup: 'child', color: '#14b8a6' });
const MEMBERS = [SAM, JO, AVA, MAX, BISCUIT];

function activity(over: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'a1',
    title: 'activity',
    date: TODAY,
    recurrence: 'none',
    category: 'other',
    assigneeIds: [],
    isActive: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as FamilyActivity;
}

function todo(over: Partial<TodoItem>): TodoItem {
  return {
    id: 't1',
    title: 'to-do',
    assigneeIds: [],
    completed: false,
    createdBy: 'sam',
    createdAt: '',
    updatedAt: '',
    ...over,
  } as TodoItem;
}

function hint(over: Partial<HintTodo>): HintTodo {
  return todo({ hintType: 'birthday-party-gift', ...over }) as HintTodo;
}

const occ = (a: FamilyActivity, date = a.date): ActivityOccurrence => ({ activity: a, date });

// ── The mockup's family on Sunday 11 October ───────────────────────────────

const PANCAKES = activity({
  id: 'pancakes',
  title: 'pancakes with grandpa',
  startTime: '08:30',
  endTime: '09:30',
});
const PARTY = activity({
  id: 'party',
  title: "Carter's party",
  startTime: '10:15',
  endTime: '12:30',
  assigneeIds: ['max'],
  location: 'FunEmpire',
  dropoffMemberId: 'sam',
  pickupMemberId: 'jo',
});
const SWIM = activity({
  id: 'swim',
  title: 'swimming lesson at Tampines pool',
  startTime: '13:00',
  endTime: '13:45',
  assigneeIds: ['max'],
});
const VET = activity({
  id: 'vet',
  title: 'Biscuit to the vet',
  startTime: '14:30',
  endTime: '15:15',
  assigneeIds: ['jo'],
});
const PIANO = activity({
  id: 'piano',
  title: 'piano',
  startTime: '16:30',
  endTime: '17:15',
  assigneeIds: ['ava'],
  dropoffMemberId: 'jo',
  pickupMemberId: 'jo',
});
const SOCCER = activity({
  id: 'soccer',
  title: 'soccer practice',
  startTime: '17:15',
  endTime: '18:30',
  assigneeIds: ['max'],
  pickupMemberId: 'sam',
});
const BEDTIME = activity({
  id: 'bedtime',
  title: 'bedtime story',
  startTime: '19:30',
  endTime: '20:00',
  assigneeIds: ['sam'],
});
const GRANDMA = activity({
  id: 'grandma',
  title: "lunch at grandma's",
  date: TOMORROW,
  startTime: '12:00',
  endTime: '14:00',
});
const PARENTS_EVENING = activity({
  id: 'parents-evening',
  title: "parents' evening",
  date: '2026-10-14',
  startTime: '18:00',
  endTime: '19:00',
  assigneeIds: ['sam'],
});
const PLAYDATE = activity({
  id: 'playdate',
  title: 'playdate',
  date: TOMORROW,
  startTime: '15:00',
  endTime: '17:00',
  assigneeIds: ['ava'],
  dropoffMemberId: 'jo',
  pickupMemberId: 'jo',
});

const TACOS_RECIPE = { id: 'r-tacos', name: 'tacos' } as Recipe;
const TACOS: MealPlanEntry = {
  id: 'm-tacos',
  date: TODAY,
  slot: 'dinner',
  position: 0,
  kind: 'recipe',
  recipeId: 'r-tacos',
  cookMemberId: 'sam',
  cooked: false,
  createdAt: '',
  updatedAt: '',
};

const SWIM_BAG = todo({
  id: 'swim-bag',
  title: 'pack swim bag',
  assigneeIds: ['max'],
  dueDate: TODAY,
  dueTime: '17:00',
});
const PASSPORTS = todo({
  id: 'passports',
  title: 'passports for the lake trip',
  assigneeIds: ['jo'],
  dueDate: TODAY,
});
const CANDLES = todo({
  id: 'candles',
  title: 'buy birthday candles',
  assigneeIds: ['sam'],
  dueDate: '2026-10-10',
});
const LIBRARY = todo({
  id: 'library',
  title: 'return library book',
  assigneeIds: ['ava'],
  dueDate: TODAY,
});
const PLUMBER = todo({
  id: 'plumber',
  title: 'call the plumber',
  assigneeIds: ['sam'],
  dueDate: '2026-10-15',
});
const GIFT_HINT = hint({
  id: 'gift-hint',
  title: "wrap a gift for Carter's party",
  assigneeIds: ['sam'],
  dueDate: TODAY,
  hintEventDate: TODAY,
});

const LAKE_TRIP = {
  id: 'lake',
  name: 'lake trip',
  tripType: 'road_trip',
  assigneeIds: ['sam', 'jo', 'ava', 'max'],
  startDate: '2026-10-15',
  endDate: '2026-10-18',
} as FamilyVacation;

const MEDS_LIST = {
  id: 'meds',
  title: "Max's meds",
  emoji: '💊',
  category: 'health',
  ownerId: 'jo',
  lifecycle: 'recurring',
  items: [{ id: 'i1', title: 'give Max his inhaler', completed: false }],
  completed: false,
  createdAt: '',
  updatedAt: '',
} as unknown as FamilyList;

const GROCERIES = {
  id: 'groceries',
  title: 'groceries',
  emoji: '🛒',
  category: 'out',
  ownerId: 'sam',
  lifecycle: 'one-off',
  dueDate: TOMORROW,
  items: [
    { id: 'g1', title: 'milk', completed: false },
    { id: 'g2', title: 'eggs', completed: true },
    { id: 'g3', title: 'tortillas', completed: false },
  ],
  completed: false,
  createdAt: '',
  updatedAt: '',
} as unknown as FamilyList;

/**
 * The Singapore family's reading, 20 minutes old at NOW (08:40 on the 11th in Singapore).
 * The 10th is yesterday there, so it is never one of the widget's days.
 */
const READING: WeatherReading = {
  v: 1,
  familyId: 'family-0000-4f2a9c',
  placeKey: '1.35,103.94|Asia/Singapore',
  fetchedAt: NOW.getTime() - 20 * 60_000,
  current: { tempC: 27.4, code: 2, isDay: true },
  daily: [
    { ymd: '2026-10-10', code: 3, maxC: 31, minC: 25 },
    { ymd: '2026-10-11', code: 95, maxC: 32.2, minC: 25.6 },
    { ymd: '2026-10-12', code: 61, maxC: 30, minC: 25 },
    { ymd: '2026-10-13', code: 2, maxC: 31, minC: 26 },
    { ymd: '2026-10-14', code: 0, maxC: 33, minC: 26 },
    { ymd: '2026-10-15', code: 80, maxC: 29, minC: 24 },
    { ymd: '2026-10-16', code: 1, maxC: 31, minC: 25 },
  ],
};
const WEATHER = { reading: READING, unit: 'C' as const, zone: 'Asia/Singapore' };

function familyInput(over: Partial<WidgetSnapshotInput> = {}): WidgetSnapshotInput {
  const todos = [SWIM_BAG, PASSPORTS, CANDLES, LIBRARY, PLUMBER, GIFT_HINT];
  return {
    occurrencesByDate: {
      [TODAY]: [PANCAKES, PARTY, SWIM, VET, PIANO, SOCCER, BEDTIME].map((a) => occ(a)),
      [TOMORROW]: [GRANDMA, PLAYDATE].map((a) => occ(a)),
      '2026-10-14': [occ(PARENTS_EVENING)],
    },
    todos,
    lists: [MEDS_LIST, GROCERIES],
    currentMember: SAM,
    resolveMember: (id) => MEMBERS.find((m) => m.id === id),
    t,
    today: TODAY,
    days: daysFrom(TODAY),
    members: MEMBERS,
    initialsById: computeInitials(MEMBERS),
    mealsByDate: { [TODAY]: [TACOS], [TOMORROW]: [] },
    recipes: [TACOS_RECIPE],
    vacations: [LAKE_TRIP],
    hintTodos: [GIFT_HINT],
    flags: { mealPlanner: true, helpfulHints: true },
    lockScreenTitles: true,
    language: 'en',
    familyId: 'family-0000-4f2a9c',
    weather: WEATHER,
    ...over,
  };
}

const build = (over: Partial<WidgetSnapshotInput> = {}) =>
  buildWidgetSnapshot(familyInput(over), NOW);
const today = (s: WidgetSnapshot) => s.days[0]!;
const titles = (day: WidgetDay | null) => (day?.rows ?? []).map((r) => r.title);

/** Local wall time read as UTC, so the fixture's epochs do not depend on the machine's zone. */
function normaliseEpochs(snapshot: WidgetSnapshot): WidgetSnapshot {
  const shift = (ms: number) => ms - new Date(ms).getTimezoneOffset() * 60_000;
  const day = (d: WidgetDay | null): WidgetDay | null =>
    d && {
      ...d,
      rows: d.rows.map((r) => ({
        ...r,
        startsAt: r.startsAt === null ? null : shift(r.startsAt),
        endsAt: r.endsAt === null ? null : shift(r.endsAt),
      })),
      pickups: d.pickups.map((p) => ({ ...p, at: shift(p.at) })),
      handoffs: d.handoffs?.map((h) => ({ ...h, at: shift(h.at) })),
    };
  return {
    ...snapshot,
    days: snapshot.days.map((e) => ({ ...e, my: day(e.my), our: day(e.our) })),
  };
}

/** Every `link` string anywhere in the snapshot. */
function allLinks(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allLinks(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'link' || k === 'nook' || k === 'todo') && typeof v === 'string') out.push(v);
      else allLinks(v, out);
    }
  }
  return out;
}

beforeEach(() => {
  // `isTodoOverdue` reads the clock: 8am local on the day.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 8, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Every key path in a JSON value, array indices collapsed to `[]` ("days[].my.rows[].title"),
 * so two snapshots of the same family compare by SHAPE.
 */
function keyPaths(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keyPaths(v, `${prefix}[]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      keyPaths(v, path, out);
    }
  }
  return out;
}

describe('buildWidgetSnapshot: the v3 fixture (cross-platform contract)', () => {
  it('equals fixtures/widget-snapshot.v3.json for the mockup family', () => {
    const { snapshot, skipped } = build();
    expect(skipped).toBe(0);
    const actual = normaliseEpochs(snapshot);
    if (process.env.UPDATE_WIDGET_FIXTURE === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(actual.version).toBe(3);
  });

  it('is the v2 shape plus optional fields only, so a v3 reader still reads the v2 fixture', () => {
    const v2 = JSON.parse(readFileSync(FIXTURE_V2, 'utf8')) as { version: number };
    const v3 = JSON.parse(readFileSync(FIXTURE, 'utf8')) as WidgetSnapshot;
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(WIDGET_SNAPSHOT_VERSION);
    expect([...WIDGET_SNAPSHOT_READABLE_VERSIONS]).toEqual([2, 3]);

    const v2Paths = keyPaths(v2);
    const v3Paths = keyPaths(v3);
    // Nothing v2 carried was renamed or removed...
    expect([...v2Paths].filter((p) => !v3Paths.has(p))).toEqual([]);
    // ...and everything new is one of the optional v3 additions (or inside one).
    const V3_ADDITIONS = [
      'weather',
      'labels.weatherAsOf',
      'labels.circleLeft',
      'labels.circleAllDone',
      'labels.circleAllClear',
      'labels.circleToDo',
      'days[].my.handoffs',
      'days[].our.handoffs',
      'days[].my.tasks.doneToday',
      'days[].our.tasks.doneToday',
      'days[].my.rows[].shortTitle',
      'days[].my.rows[].whoFirst',
      'days[].our.rows[].shortTitle',
      'days[].our.rows[].whoFirst',
    ];
    const added = [...v3Paths].filter((p) => !v2Paths.has(p));
    expect(
      added.filter(
        (p) => !V3_ADDITIONS.some((a) => p === a || p.startsWith(`${a}.`) || p.startsWith(`${a}[]`))
      )
    ).toEqual([]);
    expect(added).toEqual(expect.arrayContaining(V3_ADDITIONS));
  });
});

describe('buildWidgetSnapshot: who sees what', () => {
  it("never puts another adult's assignee-only activity in my day; our day has it", () => {
    const s = build().snapshot;
    expect(titles(today(s).my)).not.toContain('Biscuit to the vet');
    expect(titles(today(s).our)).toContain('Biscuit to the vet');
  });

  it("shows a child's activity to an adult (forChild), and family-wide events only on our day", () => {
    const s = build().snapshot;
    expect(titles(today(s).my)).toContain('swimming lesson at Tampines pool');
    expect(titles(today(s).my)).not.toContain('pancakes with grandpa');
    expect(today(s).our?.rows.find((r) => r.title === 'pancakes with grandpa')?.dot).toEqual({
      kind: 'family',
    });
  });

  it('a child session publishes only the child’s own day: no our day, no hints, no to-dos', () => {
    const { snapshot } = build({ currentMember: AVA, hintTodos: [GIFT_HINT] });
    expect(snapshot.viewer).toMatchObject({ memberId: 'ava', isChild: true, avatar: 'girl' });
    for (const entry of snapshot.days) {
      expect(entry.our).toBeNull();
      expect(entry.my?.tasks.items).toEqual([]);
      expect(entry.my?.tasks.count).toBe(0);
    }
    expect(titles(today(snapshot).my)).toEqual(['piano']);
    expect(titles(snapshot.days[1]!.my)).toEqual(['playdate']);
  });

  it("never names another member's birthday on a child's widget", () => {
    const birthdays = (s: WidgetSnapshot) =>
      s.days.flatMap((d) =>
        (d.my?.rows ?? []).filter((r) => r.kind === 'birthday').map((r) => r.title)
      );
    expect(birthdays(build().snapshot)).toEqual(["Jo's birthday"]);
    expect(birthdays(build({ currentMember: AVA }).snapshot)).toEqual([]);
  });

  it('a surprise hint reaches the viewer it is for, never our day', () => {
    const present = hint({
      id: 'present',
      title: "a present for Max's birthday",
      hintType: 'birthday-present',
      assigneeIds: ['sam', 'jo'],
      hintEventDate: '2026-11-01',
    });
    const s = build({ hintTodos: [present] }).snapshot;
    const tasks = (d: WidgetDay | null) => (d?.tasks.items ?? []).map((i) => i.title);
    expect(tasks(today(s).my)).toContain("a present for Max's birthday");
    expect(tasks(today(s).our)).not.toContain("a present for Max's birthday");
  });

  it('never carries a private list, on either audience', () => {
    const json = JSON.stringify(build().snapshot);
    expect(json).not.toContain('give Max his inhaler');
    expect(json).not.toContain("Max's meds");
  });
});

describe('buildWidgetSnapshot: the calendar section', () => {
  it('fills every part for a full day', () => {
    const my = today(build().snapshot).my!;
    expect(my.rows.length).toBeGreaterThan(0);
    expect(my.rows.every((r) => r.kind === 'event')).toBe(true);
    expect(my.rows.some((r) => r.handoff)).toBe(true);
    expect(my.tonight?.text).toBe('tonight: tacos, you cook');
    expect(my.tasks.items.length).toBeGreaterThan(0);
  });

  it('carries the calendar only: trips, then birthdays, then events, never a to-do', () => {
    const thu = build().snapshot.days.find((d) => d.ymd === '2026-10-16')!;
    expect(thu.our!.rows.map((r) => [r.kind, r.title])).toEqual([
      ['trip', 'lake trip · day 2 of 4'],
      ['birthday', "Jo's birthday"],
    ]);
    const json = JSON.stringify(build().snapshot.days.map((d) => d.my?.rows));
    expect(json).not.toContain('pack swim bag');
  });

  it("starts a trip on its first day for the look-ahead, and pins a running trip to today's only", () => {
    const days = build().snapshot.days;
    const trip = (ymd: string) =>
      days.find((d) => d.ymd === ymd)!.my!.rows.find((r) => r.kind === 'trip');
    expect(trip('2026-10-14')).toBeUndefined();
    expect(trip('2026-10-15')).toMatchObject({
      title: 'lake trip · starts',
      titleEmphasis: 'starts',
      todayOnly: false,
    });
    expect(trip('2026-10-16')).toMatchObject({ title: 'lake trip · day 2 of 4', todayOnly: true });
  });

  it("shows another adult's trip on my day too, but not on a child's", () => {
    const solo = {
      ...LAKE_TRIP,
      id: 'solo',
      name: 'work trip',
      assigneeIds: ['jo'],
    } as FamilyVacation;
    const days = build({ vacations: [solo] }).snapshot.days;
    expect(days.some((d) => d.my!.rows.some((r) => r.kind === 'trip'))).toBe(true);
    expect(days.some((d) => d.our!.rows.some((r) => r.kind === 'trip'))).toBe(true);
    const child = build({ vacations: [solo], currentMember: AVA }).snapshot.days;
    expect(child.some((d) => d.my!.rows.some((r) => r.kind === 'trip'))).toBe(false);
  });

  it('orders timed rows first, and an all-day row has no instants and no time', () => {
    const fair = activity({
      id: 'fair',
      title: 'school fair',
      isAllDay: true,
      assigneeIds: ['sam'],
    });
    const s = build({
      occurrencesByDate: { [TODAY]: [occ(fair), occ(BEDTIME)], [TOMORROW]: [] },
      vacations: [],
      members: [SAM, AVA, MAX],
    }).snapshot;
    const rows = today(s).my!.rows;
    expect(rows.map((r) => r.title)).toEqual(['bedtime story', 'school fair']);
    expect(rows[1]).toMatchObject({ time: '', startsAt: null, endsAt: null });
    expect(rows[0]!.time).toBe('7:30pm');
    expect(rows[0]!.endsAt).toBe(new Date(2026, 9, 11, 20, 0).getTime());
  });

  it("marks a row done only when the viewer's duties on it are ticked for that date", () => {
    const done = {
      ...PARTY,
      dropoffCompletions: [{ date: TODAY, completedBy: 'sam', completedAt: '' }],
    };
    const s = build({
      occurrencesByDate: { [TODAY]: [occ(done), occ(SOCCER), occ(SWIM)], [TOMORROW]: [] },
    }).snapshot;
    const byTitle = new Map(today(s).my!.rows.map((r) => [r.title, r.isDone]));
    expect(byTitle.get("Carter's party")).toBe(true);
    expect(byTitle.get('soccer practice')).toBe(false);
    expect(byTitle.get('swimming lesson at Tampines pool')).toBe(false);
  });

  it('writes the handoff as "drives" for one driver and as a line for two', () => {
    const rows = today(build().snapshot).my!.rows;
    expect(rows.find((r) => r.title === 'piano')?.handoff).toEqual({
      inlineTitle: 'piano, Jo drives',
      avatars: [],
    });
    expect(rows.find((r) => r.title === "Carter's party")?.handoff).toEqual({
      line: 'Sam drops off, Jo picks up 12:30pm',
      avatars: ['father', 'mother'],
    });
  });

  it("lists the viewer's pick-ups on my day only", () => {
    const s = build().snapshot;
    expect(today(s).my!.pickups).toEqual([
      { at: new Date(2026, 9, 11, 18, 30).getTime(), text: 'pick-up 6:30pm, Max' },
    ]);
    expect(today(s).our!.pickups).toEqual([]);
  });

  it('never puts an activity title in a pick-up line (it is shown on the lock screen)', () => {
    const errand = activity({
      id: 'errand',
      title: 'oncology appointment',
      date: TODAY,
      startTime: '14:00',
      endTime: '15:00',
      assigneeIds: [],
      pickupMemberId: 'sam',
    });
    const s = build({ occurrencesByDate: { [TODAY]: [occ(errand)], [TOMORROW]: [] } }).snapshot;
    expect(today(s).my!.pickups.map((p) => p.text)).toEqual(['pick-up 3pm']);
  });

  it('names the child being collected, never the driver, in a pick-up line', () => {
    const lesson = activity({
      id: 'lesson',
      title: 'lesson',
      date: TODAY,
      startTime: '14:00',
      endTime: '15:00',
      assigneeIds: ['sam', 'max'],
      pickupMemberId: 'sam',
    });
    const s = build({ occurrencesByDate: { [TODAY]: [occ(lesson)], [TOMORROW]: [] } }).snapshot;
    expect(today(s).my!.pickups.map((p) => p.text)).toEqual(['pick-up 3pm, Max']);
  });

  it('shows a trip on its departure day only', () => {
    const trip = activity({
      id: 'trip-leg',
      title: 'drive to the lake',
      date: '2026-10-10',
      endDate: '2026-10-13',
      isAllDay: true,
      vacationId: 'lake',
    });
    const on = (date: string) =>
      build({
        today: date,
        days: daysFrom(date),
        vacations: [],
        occurrencesByDate: { [date]: [occ(trip, date)] },
      }).snapshot;
    expect(titles(today(on('2026-10-11')).our)).toEqual([]);
    expect(titles(today(on('2026-10-10')).our)).toEqual(['drive to the lake']);
  });

  it('carries the whole look-ahead, each day with its divider date', () => {
    const s = build().snapshot;
    expect(s.days.map((d) => d.ymd)).toEqual(daysFrom(TODAY));
    expect(s.days[1]).toMatchObject({ weekday: 'Monday', numeral: '12', dividerDate: 'Mon 12' });
    expect(titles(s.days[1]!.our)).toEqual(["lunch at grandma's", 'playdate']);
    expect(titles(s.days[3]!.my)).toEqual(["parents' evening"]);
  });
});

describe('buildWidgetSnapshot: the to-dos section', () => {
  const tasks = (d: WidgetDay | null) =>
    (d?.tasks.items ?? []).map((i) => [i.kind, i.title, i.tag, i.tagTone]);

  it('ranks to-dos, hints and lists together by when they are due, never by kind', () => {
    // Sam's view: the overdue candles; today, the timed swim bag, then Ava's library book and
    // the gift hint (a hint ranks exactly like a to-do); later this week, the groceries list
    // (tomorrow) and the plumber (Thursday). Jo's passports are another adult's.
    expect(tasks(today(build().snapshot).my)).toEqual([
      ['todo', 'buy birthday candles', 'overdue', 'accent'],
      ['todo', 'pack swim bag', 'by 5pm', 'accent'],
      ['todo', 'return library book', 'today', 'accent'],
      ['hint', "wrap a gift for Carter's party", 'today', 'accent'],
      ['list', 'groceries, 2 left', 'Mon 12', 'soft'],
      ['todo', 'call the plumber', 'Thu 15', 'soft'],
    ]);
  });

  it('counts what is due now, never what is later this week', () => {
    const s = build().snapshot;
    const my = today(s).my!.tasks;
    // Hints are listed but not counted: the count is what the `due` switch shows.
    expect(my.count).toBe(3);
    expect(my.countText).toEqual({ text: '3 for you today', emphasis: '3' });
    expect(my.heading).toBe('to-dos and lists');
    const our = today(s).our!.tasks;
    // Wall rule: every owner, overdue and today (undated is not counted on our day).
    expect(our.count).toBe(4);
    expect(our.countText.text).toBe('4 due today');
  });

  it('builds each day as if it were today, so the order holds after midnight', () => {
    const tomorrow = build().snapshot.days[1]!.my!.tasks.items;
    expect(tomorrow.find((i) => i.kind === 'list')).toMatchObject({
      bucket: 'today',
      tag: 'today',
    });
    expect(tomorrow[0]).toMatchObject({ title: 'buy birthday candles', bucket: 'overdue' });
  });

  it('shows an undated to-do of mine with no tag, after today and before later', () => {
    const renew = todo({ id: 'renew', title: "renew Ava's passport", assigneeIds: ['sam'] });
    const items = today(build({ todos: [renew, PLUMBER], hintTodos: [], lists: [] }).snapshot).my!
      .tasks.items;
    expect(items.map((i) => [i.title, i.bucket, i.tag])).toEqual([
      ["renew Ava's passport", 'undated', ''],
      ['call the plumber', 'later', 'Thu 15'],
    ]);
  });

  it("leaves out a task due past the look-ahead, an emptied list and another adult's list", () => {
    const far = todo({ id: 'far', title: 'far off', assigneeIds: ['sam'], dueDate: '2026-10-30' });
    const empty = { ...GROCERIES, id: 'empty', title: 'empty', items: [] } as FamilyList;
    const jos = { ...GROCERIES, id: 'jos', title: "Jo's list", ownerId: 'jo' } as FamilyList;
    const titlesOf = (d: WidgetDay | null) => (d?.tasks.items ?? []).map((i) => i.title);
    const s = build({ todos: [far], lists: [empty, jos], hintTodos: [] }).snapshot;
    expect(titlesOf(today(s).my)).toEqual([]);
    expect(titlesOf(today(s).our)).toEqual(["Jo's list, 2 left"]);
  });

  it('ranks a hint by its event, never its nudge date: never overdue, no time', () => {
    // The nudge date (dueDate) is in the past for the whole lead window.
    const cake = hint({
      id: 'cake',
      title: 'order the birthday cake',
      dueDate: '2026-10-08',
      dueTime: '09:00',
      hintEventDate: '2026-10-17',
    });
    const s = build({ todos: [], lists: [], hintTodos: [cake] }).snapshot;
    expect(today(s).my!.tasks.items).toEqual([
      expect.objectContaining({ kind: 'hint', bucket: 'undated', tag: '', timed: false }),
    ]);
    expect(today(s).my!.tasks.count).toBe(0);
    const onTheDay = s.days.find((d) => d.ymd === '2026-10-17')!.my!.tasks.items[0];
    expect(onTheDay).toMatchObject({ bucket: 'today', tag: 'today' });
  });

  it('caps a day at MAX_WIDGET_TASKS and says how many there were', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      todo({ id: `t${i}`, title: `to-do ${i}`, assigneeIds: ['sam'] })
    );
    const tasks = today(build({ todos: many, lists: [], hintTodos: [] }).snapshot).my!.tasks;
    expect(tasks.items).toHaveLength(MAX_WIDGET_TASKS);
    expect(tasks.overflow).toEqual({ due: 30 - MAX_WIDGET_TASKS, hint: 0 });
    expect(tasks.count).toBe(30);
  });

  it('caps hints separately, so a long to-do list never crowds them out', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      todo({ id: `t${i}`, title: `to-do ${i}`, assigneeIds: ['sam'], dueDate: '2026-10-01' })
    );
    const gift = hint({ id: 'g', title: 'wrap the gift', hintEventDate: '2026-10-13' });
    const tasks = today(build({ todos: many, lists: [], hintTodos: [gift] }).snapshot).my!.tasks;
    expect(tasks.items.filter((i) => i.kind === 'hint').map((i) => i.title)).toEqual([
      'wrap the gift',
    ]);
    expect(tasks.overflow).toEqual({ due: 4, hint: 0 });
    expect(tasks.heading).toBe('to-dos');
  });

  it("puts a dot on someone else's task, and none on my own or a hint", () => {
    const items = today(build().snapshot).my!.tasks.items;
    const dot = (title: string) => items.find((i) => i.title === title)?.dot;
    expect(dot('pack swim bag')).toMatchObject({ kind: 'member', initial: 'M' });
    expect(dot('buy birthday candles')).toBeNull();
    expect(dot("wrap a gift for Carter's party")).toBeNull();
  });
});

describe('buildWidgetSnapshot: failure isolation and links', () => {
  it('a throwing block empties only that block and counts it as skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const malformed = [null as unknown as MealPlanEntry];
    const { snapshot, skipped } = build({ mealsByDate: { [TODAY]: malformed, [TOMORROW]: [] } });
    // One malformed meal on today: the meals block of today's my AND our day.
    expect(skipped).toBe(2);
    expect(today(snapshot).my!.tonight).toBeNull();
    expect(today(snapshot).my!.rows.length).toBeGreaterThan(0);
    expect(today(snapshot).my!.tasks.items.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("dropped 'meals'"),
      expect.anything()
    );
  });

  it('every link is absolute on the shareable origin and already carries src=widget', () => {
    const links = allLinks(build().snapshot);
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      expect(link.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(new URL(link).searchParams.get('src')).toBe('widget');
    }
  });

  it('links the meal planner only while its flag is on', () => {
    const off = build({ flags: { mealPlanner: false, helpfulHints: true } }).snapshot;
    expect(today(off).my!.tonight).toBeNull();
    expect(JSON.stringify(off)).not.toContain('/meal-planner');
  });
});

describe('buildWidgetSnapshot: v3 weather', () => {
  it('is null when weather is off or has no town, when there is no reading, and with no entry for today', () => {
    expect(build({ weather: null }).snapshot.weather).toBeNull();
    expect(build({ weather: { ...WEATHER, reading: null } }).snapshot.weather).toBeNull();
    const stale = { ...READING, daily: READING.daily.filter((d) => d.ymd < '2026-10-11') };
    expect(build({ weather: { ...WEATHER, reading: stale } }).snapshot.weather).toBeNull();
  });

  it('carries the staleness thresholds as instants from fetchedAt', () => {
    const w = build().snapshot.weather!;
    expect(w.fetchedAt).toBe(READING.fetchedAt);
    expect(w.ageFrom).toBe(READING.fetchedAt + AGE_SHOW_MS);
    expect(w.currentUntil).toBe(READING.fetchedAt + CURRENT_MAX_MS);
  });

  it('formats the current reading with the web atom’s helpers, in the family’s unit', () => {
    expect(build().snapshot.weather!.current).toEqual({
      glyph: 'partly',
      temp: '27°',
      condition: 'Partly cloudy',
    });
    const night = { ...READING, current: { tempC: 12.6, code: 0, isDay: false } };
    expect(
      build({ weather: { ...WEATHER, unit: 'F', reading: night } }).snapshot.weather!.current
    ).toEqual({ glyph: 'night', temp: '55°', condition: 'Clear' });
  });

  it('picks five days from the HOME-ZONE today, by date, with day glyphs and the range', () => {
    // NOW is 08:40 on the 11th in Singapore and 17:40 on the 10th in Los Angeles.
    const sg = build().snapshot.weather!.days;
    expect(sg.map((d) => d.ymd)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ]);
    expect(sg[0]).toEqual({
      ymd: '2026-10-11',
      glyph: 'thunder',
      high: '32°',
      low: '26°',
      range: '32° / 26°',
    });
    const shuffled = { ...READING, daily: [...READING.daily].reverse() };
    const la = build({ weather: { ...WEATHER, zone: 'America/Los_Angeles', reading: shuffled } })
      .snapshot.weather!.days;
    expect(la.map((d) => d.ymd)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });

  it('drops only the weather when the reading is malformed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { ...READING, daily: null } as unknown as WeatherReading;
    const { snapshot, skipped } = build({ weather: { ...WEATHER, reading: broken } });
    expect(snapshot.weather).toBeNull();
    expect(skipped).toBe(1);
    expect(titles(today(snapshot).my).length).toBeGreaterThan(0);
  });
});

describe('buildWidgetSnapshot: v3 handoffs', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 11, h, m).getTime();

  it("lists the viewer's own drop-offs and pick-ups, both kinds, on my day only", () => {
    const s = build().snapshot;
    const partyLink = today(s).my!.rows.find((r) => r.title === "Carter's party")!.link;
    expect(today(s).my!.handoffs).toEqual([
      { at: at(10, 15), kind: 'dropoff', name: 'Max', link: partyLink },
      {
        at: at(18, 30),
        kind: 'pickup',
        name: 'Max',
        link: today(s).my!.rows.find((r) => r.title === 'soccer practice')!.link,
      },
    ]);
    expect(today(s).our!.handoffs).toEqual([]);
  });

  it("never lists another adult's duties", () => {
    const jo = build({ currentMember: JO }).snapshot;
    expect(today(jo).my!.handoffs!.map((h) => [h.kind, h.at, h.name])).toEqual([
      ['pickup', at(12, 30), 'Max'],
      ['dropoff', at(16, 30), 'Ava'],
      ['pickup', at(17, 15), 'Ava'],
    ]);
  });
});

describe('buildWidgetSnapshot: v3 doneToday', () => {
  const doneAt = (h: number) => new Date(2026, 9, 11, h, 0).toISOString();

  it('counts to-dos completed today that would count open, and never adds them as rows', () => {
    const doneToday = todo({
      id: 'done-today',
      title: 'sign the form',
      assigneeIds: ['sam'],
      dueDate: TODAY,
      completed: true,
      completedAt: doneAt(7),
    });
    const doneOverdue = todo({
      id: 'done-overdue',
      title: 'renew the permit',
      assigneeIds: ['sam'],
      dueDate: '2026-10-09',
      completed: true,
      completedAt: doneAt(7),
    });
    const doneYesterday = todo({
      id: 'done-yesterday',
      title: 'old one',
      assigneeIds: ['sam'],
      dueDate: '2026-10-10',
      completed: true,
      completedAt: new Date(2026, 9, 10, 19, 0).toISOString(),
    });
    const doneLater = todo({
      id: 'done-later',
      title: 'early bird',
      assigneeIds: ['sam'],
      dueDate: '2026-10-14',
      completed: true,
      completedAt: doneAt(7),
    });
    const before = today(build().snapshot);
    const s = build({
      todos: [
        SWIM_BAG,
        PASSPORTS,
        CANDLES,
        LIBRARY,
        PLUMBER,
        GIFT_HINT,
        doneToday,
        doneOverdue,
        doneYesterday,
        doneLater,
      ],
    }).snapshot;
    for (const view of ['my', 'our'] as const) {
      const tasks = today(s)[view]!.tasks;
      expect(tasks.doneToday).toBe(2);
      expect(tasks.count).toBe(before[view]!.tasks.count);
      expect(tasks.items.map((i) => i.title)).toEqual(
        before[view]!.tasks.items.map((i) => i.title)
      );
    }
    expect(build().snapshot.days[0]!.my!.tasks.doneToday).toBe(0);
  });
});

describe('buildWidgetSnapshot: v3 row words', () => {
  it('gives each row its first word, in English and in Chinese', () => {
    const rows = today(build().snapshot).my!.rows;
    expect(rows.find((r) => r.title.startsWith('swimming'))?.shortTitle).toBe('swimming');
    expect(rows.find((r) => r.title === "Carter's party")?.shortTitle).toBe("Carter's");

    const title = '游泳课在淡马锡';
    const swim = activity({ ...SWIM, title });
    const zh = today(
      build({ language: 'zh', occurrencesByDate: { [TODAY]: [occ(swim)], [TOMORROW]: [] } })
        .snapshot
    ).our!.rows[0]!;
    expect(zh.shortTitle!.length).toBeGreaterThan(0);
    expect(zh.shortTitle!.length).toBeLessThan(title.length);
    expect(title.startsWith(zh.shortTitle!)).toBe(true);
  });

  it('names the first assignee who still resolves, and nobody when none does', () => {
    const duo = activity({
      id: 'duo',
      title: 'duet practice',
      startTime: '11:00',
      endTime: '12:00',
      assigneeIds: ['gone', 'ava', 'max'],
    });
    const family = activity({ id: 'family', title: 'family walk', startTime: '09:00' });
    const rows = today(
      build({ occurrencesByDate: { [TODAY]: [occ(duo), occ(family)], [TOMORROW]: [] } }).snapshot
    ).our!.rows;
    expect(rows.find((r) => r.id.startsWith('duo'))).toMatchObject({
      who: 'Ava & Max',
      whoFirst: 'Ava',
    });
    expect(rows.find((r) => r.id.startsWith('family'))?.whoFirst).toBe('');
  });
});
