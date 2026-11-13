/**
 * The home-screen widget snapshot builder (#130). Local factories, no Pinia (the
 * `wallJobs.test.ts` shape).
 *
 * The fixture test is the cross-platform contract: `fixtures/widget-snapshot.v4.json` is the
 * builder's output for the mockup's family, and the Swift and Java readers use it as their
 * sample. Regenerate it ONLY on a deliberate schema or copy change, and review the diff:
 *
 *   UPDATE_WIDGET_FIXTURE=1 npx vitest run src/utils/__tests__/widgetSnapshot.test.ts
 *   npx prettier --write src/utils/__tests__/fixtures/widget-snapshot.v4.json
 *
 * `fixtures/widget-snapshot.v3.json` and `.v2.json` are frozen: the older shapes the readers
 * still accept (readers take 2, 3 and 4). Tests below prove v3 only ADDED optional fields to
 * v2, and that v4 only folded v3's `my` + `our` into one `view` and dropped the two day
 * labels. Delete the v3 fixture (and the native `view ?? our ?? my` fallback) when 3 leaves
 * the readable versions.
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
  Chore,
  ChoreMark,
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

const FIXTURE = resolve(__dirname, 'fixtures/widget-snapshot.v4.json');
const FIXTURE_V3 = resolve(__dirname, 'fixtures/widget-snapshot.v3.json');
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

/**
 * Due tomorrow and shown right away by choice (`showOn: 'now'`), so it is a `later` row today.
 * A list's default is its due date only (plan 2026-11-13); without the rule it would wait.
 */
const GROCERIES = {
  id: 'groceries',
  title: 'groceries',
  emoji: '🛒',
  category: 'out',
  ownerId: 'sam',
  lifecycle: 'one-off',
  dueDate: TOMORROW,
  showOn: 'now',
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
const titles = (day: WidgetDay) => day.rows.map((r) => r.title);

/** Local wall time read as UTC, so the fixture's epochs do not depend on the machine's zone. */
function normaliseEpochs(snapshot: WidgetSnapshot): WidgetSnapshot {
  const shift = (ms: number) => ms - new Date(ms).getTimezoneOffset() * 60_000;
  const day = (d: WidgetDay): WidgetDay => ({
    ...d,
    rows: d.rows.map((r) => ({
      ...r,
      startsAt: r.startsAt === null ? null : shift(r.startsAt),
      endsAt: r.endsAt === null ? null : shift(r.endsAt),
    })),
    pickups: d.pickups.map((p) => ({ ...p, at: shift(p.at) })),
    handoffs: d.handoffs?.map((h) => ({ ...h, at: shift(h.at) })),
  });
  return { ...snapshot, days: snapshot.days.map((e) => ({ ...e, view: day(e.view) })) };
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
 * Every key path in a JSON value, array indices collapsed to `[]` ("days[].view.rows[].title"),
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

describe('buildWidgetSnapshot: the v4 fixture (cross-platform contract)', () => {
  it('equals fixtures/widget-snapshot.v4.json for the mockup family', () => {
    const { snapshot, skipped } = build();
    expect(skipped).toBe(0);
    const actual = normaliseEpochs(snapshot);
    if (process.env.UPDATE_WIDGET_FIXTURE === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(actual.version).toBe(4);
    expect(WIDGET_SNAPSHOT_VERSION).toBe(4);
    expect([...WIDGET_SNAPSHOT_READABLE_VERSIONS]).toEqual([2, 3, 4]);
  });

  it('carries one view per day: no my / our, and no my-day / our-day labels', () => {
    const { snapshot } = build();
    for (const entry of snapshot.days) {
      expect(Object.keys(entry)).toContain('view');
      expect(Object.keys(entry)).not.toContain('my');
      expect(Object.keys(entry)).not.toContain('our');
    }
    expect(Object.keys(snapshot.labels)).not.toContain('myDay');
    expect(Object.keys(snapshot.labels)).not.toContain('ourDay');
  });

  it('carries the six To-dos focus labels', () => {
    const { snapshot } = build();
    expect(snapshot.labels).toMatchObject({
      groupOverdue: 'overdue',
      groupToday: 'due today',
      groupComingUp: 'coming up',
      allTodos: 'all to-dos ›',
      todosAllClear: 'all clear,',
      eventsHeading: 'next up',
    });
  });

  // The frozen v3 file is what the native fallback (`view ?? our ?? my`) and the Android tests
  // read as "a snapshot stored before the update": it must keep the OLD shape.
  it('keeps the frozen v3 fixture in its old shape (my + our, the two day labels)', () => {
    const v3 = JSON.parse(readFileSync(FIXTURE_V3, 'utf8')) as {
      version: number;
      labels: Record<string, string>;
      days: Record<string, unknown>[];
    };
    expect(v3.version).toBe(3);
    expect(v3.days[0]).toHaveProperty('my');
    expect(v3.days[0]).toHaveProperty('our');
    expect(v3.days[0]).not.toHaveProperty('view');
    expect(v3.labels).toHaveProperty('myDay');
    expect(v3.labels).toHaveProperty('ourDay');
  });

  it('is the v3 shape with my + our folded into view, the day labels dropped, and two optional additions', () => {
    const v3 = JSON.parse(readFileSync(FIXTURE_V3, 'utf8')) as unknown;
    const v4 = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown;
    const folded = new Set(
      [...keyPaths(v3)]
        .filter((p) => p !== 'labels.myDay' && p !== 'labels.ourDay')
        .map((p) => p.replace(/^days\[\]\.(my|our)(?=\.|$)/, 'days[].view'))
    );
    // The lock screen's own-day fields: optional, so a v2/v3 reader is unaffected.
    // The To-dos focus labels (2026-11-11) are optional too: native tolerates their absence.
    const V4_ADDITIONS = [
      'labels.groupOverdue',
      'labels.groupToday',
      'labels.groupComingUp',
      'labels.allTodos',
      'labels.todosAllClear',
      'labels.eventsHeading',
      'days[].view.rows[].mine',
      'days[].view.ownThingsText',
    ];
    const v4Paths = keyPaths(v4);
    expect([...folded].filter((p) => !v4Paths.has(p))).toEqual([]);
    expect([...v4Paths].filter((p) => !folded.has(p))).toEqual(V4_ADDITIONS);
  });

  it('is the v2 shape plus optional fields only, so a v3 reader still reads the v2 fixture', () => {
    const v2 = JSON.parse(readFileSync(FIXTURE_V2, 'utf8')) as { version: number };
    const v3 = JSON.parse(readFileSync(FIXTURE_V3, 'utf8')) as { version: number };
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);

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
  it("shows every event on an adult's widget: another adult's, a child's and the family's", () => {
    const s = build().snapshot;
    expect(titles(today(s).view)).toEqual([
      'pancakes with grandpa',
      "Carter's party",
      'swimming lesson at Tampines pool',
      'Biscuit to the vet',
      'piano',
      'soccer practice',
      'bedtime story',
    ]);
    expect(today(s).view.rows.find((r) => r.title === 'pancakes with grandpa')?.dot).toEqual({
      kind: 'family',
    });
    // The same family calendar on every adult's phone.
    expect(titles(today(build({ currentMember: JO }).snapshot).view)).toEqual(
      titles(today(s).view)
    );
  });

  // The lock screen keeps to the viewer's own day (v2/v3's "my day" rule); the home screen
  // shows the whole family's.
  it("marks the viewer's own rows mine: a partner's event and a family-wide one are not", () => {
    const s = build().snapshot;
    const mine = (title: string) => today(s).view.rows.find((r) => r.title === title)?.mine;
    // Jo's own event is on the family view, but never on Sam's lock screen.
    expect(mine('Biscuit to the vet')).toBe(false);
    // Nobody assigned: a family-wide event is not the viewer's own (as on the old my day).
    expect(mine('pancakes with grandpa')).toBe(false);
    // Sam's own, his child's, and Max's party Sam drops off at.
    expect(mine('bedtime story')).toBe(true);
    expect(mine('swimming lesson at Tampines pool')).toBe(true);
    expect(mine("Carter's party")).toBe(true);
    // Ava's piano, which Jo drives: still Sam's child's.
    expect(mine('piano')).toBe(true);
    // From Jo's phone the vet is hers.
    const jo = build({ currentMember: JO }).snapshot;
    expect(today(jo).view.rows.find((r) => r.title === 'Biscuit to the vet')?.mine).toBe(true);
    expect(today(jo).view.rows.find((r) => r.title === 'bedtime story')?.mine).toBe(false);
  });

  it('marks an event the whole family is assigned to mine, and every trip and birthday', () => {
    const everyone = activity({
      id: 'everyone',
      title: 'family photo',
      startTime: '11:00',
      endTime: '11:30',
      assigneeIds: ['sam', 'jo', 'ava', 'max'],
    });
    const partnerTrip = { ...LAKE_TRIP, id: 'jo-trip', name: 'conference', assigneeIds: ['jo'] };
    const s = build({
      occurrencesByDate: { [TODAY]: [occ(everyone), occ(VET)] },
      vacations: [LAKE_TRIP, partnerTrip],
    }).snapshot;
    expect(today(s).view.rows.find((r) => r.id.startsWith('everyone'))?.mine).toBe(true);
    const comingUp = s.days.flatMap((d) => d.view.rows.filter((r) => r.kind !== 'event'));
    expect(comingUp.map((r) => r.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('conference'), "Jo's birthday"])
    );
    expect(comingUp.every((r) => r.mine === true)).toBe(true);
  });

  it("counts only the viewer's own rows in ownThingsText", () => {
    const s = build().snapshot;
    const day = today(s).view;
    expect(day.rows).toHaveLength(7);
    expect(day.thingsText).toBe('7 things on today');
    expect(day.rows.filter((r) => r.mine)).toHaveLength(5);
    expect(day.ownThingsText).toBe('5 things on today');
    // A day with only someone else's event: the family has one thing on, the viewer nothing.
    const quiet = build({ occurrencesByDate: { [TODAY]: [occ(VET)] }, vacations: [] }).snapshot;
    expect(today(quiet).view.thingsText).toBe('1 thing on today');
    expect(today(quiet).view.ownThingsText).toBe('nothing on today');
  });

  it("the viewer's pick-ups and handoffs on the family view are only their own", () => {
    const s = build({ currentMember: JO }).snapshot;
    const day = today(s).view;
    // Jo collects Max from the party and drives Ava to piano; Sam's soccer pick-up is not hers.
    expect(day.handoffs?.map((h) => [h.kind, h.name])).toEqual([
      ['pickup', 'Max'],
      ['dropoff', 'Ava'],
      ['pickup', 'Ava'],
    ]);
    expect(day.pickups.map((p) => p.text)).toEqual(['pick-up 12:30pm, Max', 'pick-up 5:15pm, Ava']);
  });

  it("a child's view marks every row mine, so its own things text is its things text", () => {
    const { snapshot } = build({ currentMember: AVA });
    for (const entry of snapshot.days) {
      expect(entry.view.rows.every((r) => r.mine === true)).toBe(true);
      expect(entry.view.ownThingsText).toBe(entry.view.thingsText);
    }
  });

  it('a child session publishes only the child’s own day: no hints, no to-dos', () => {
    const { snapshot } = build({ currentMember: AVA, hintTodos: [GIFT_HINT] });
    expect(snapshot.viewer).toMatchObject({ memberId: 'ava', isChild: true, avatar: 'girl' });
    for (const entry of snapshot.days) {
      expect(entry.view.tasks.items).toEqual([]);
      expect(entry.view.tasks.count).toBe(0);
      expect(entry.view.tasks.countText).toEqual({ text: '' });
    }
    expect(titles(today(snapshot).view)).toEqual(['piano']);
    expect(titles(snapshot.days[1]!.view)).toEqual(['playdate']);
  });

  it("never names another member's birthday on a child's widget", () => {
    const birthdays = (s: WidgetSnapshot) =>
      s.days.flatMap((d) => d.view.rows.filter((r) => r.kind === 'birthday').map((r) => r.title));
    expect(birthdays(build().snapshot)).toEqual(["Jo's birthday"]);
    expect(birthdays(build({ currentMember: AVA }).snapshot)).toEqual([]);
  });

  // The one deliberate difference from the briefing: a home screen is glanceable by the person
  // the surprise is for, so the widget never shows a surprise hint, even to its assignee.
  it('never shows a surprise hint, even to the viewer it is for; a plain hint shows', () => {
    const present = hint({
      id: 'present',
      title: "a present for Max's birthday",
      hintType: 'birthday-present',
      assigneeIds: ['sam', 'jo'],
      hintEventDate: '2026-11-01',
    });
    const s = build({ hintTodos: [present, GIFT_HINT] }).snapshot;
    const tasks = today(s).view.tasks.items.map((i) => i.title);
    expect(tasks).not.toContain("a present for Max's birthday");
    expect(tasks).toContain("wrap a gift for Carter's party");
  });

  it("never carries another adult's private list", () => {
    const json = JSON.stringify(build().snapshot);
    expect(json).not.toContain('give Max his inhaler');
    expect(json).not.toContain("Max's meds");
  });

  // greg, 2026-11-10: the widget's to-dos and lists are the daily briefing's, so private
  // categories follow the briefing too: the viewer's own and their children's, never a partner's.
  it("shows the viewer's own and a child's private list, never another adult's", () => {
    const priv = (id: string, ownerId: string): FamilyList =>
      ({
        ...GROCERIES,
        id,
        title: `${id} list`,
        category: 'health',
        ownerId,
        dueDate: TODAY,
      }) as FamilyList;
    const s = build({
      todos: [],
      hintTodos: [],
      lists: [priv('sams', 'sam'), priv('avas', 'ava'), priv('jos', 'jo')],
    }).snapshot;
    expect(today(s).view.tasks.items.map((i) => i.title)).toEqual([
      'sams list, 2 left',
      'avas list, 2 left',
    ]);
  });

  it("never shows a partner's to-dos or lists; unassigned and children's to-dos do show", () => {
    const shared = todo({ id: 'shared', title: 'book the plumber', dueDate: TODAY });
    const jos = { ...GROCERIES, id: 'jos', title: "Jo's errands", ownerId: 'jo' } as FamilyList;
    const s = build({
      todos: [PASSPORTS, LIBRARY, shared],
      lists: [jos],
      hintTodos: [],
    }).snapshot;
    const shown = today(s).view.tasks.items.map((i) => i.title);
    expect(shown).toEqual(['return library book', 'book the plumber']);
    // Jo sees her own passports and errands, and the same unassigned and children's to-dos.
    const jo = today(
      build({ currentMember: JO, todos: [PASSPORTS, LIBRARY, shared], lists: [jos], hintTodos: [] })
        .snapshot
    ).view.tasks.items.map((i) => i.title);
    expect(jo).toEqual(
      expect.arrayContaining([
        'passports for the lake trip',
        'return library book',
        'book the plumber',
      ])
    );
    expect(jo).toContain("Jo's errands, 2 left");
  });
});

describe('buildWidgetSnapshot: the calendar section', () => {
  it('fills every part for a full day', () => {
    const view = today(build().snapshot).view;
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows.every((r) => r.kind === 'event')).toBe(true);
    expect(view.rows.some((r) => r.handoff)).toBe(true);
    expect(view.tonight?.text).toBe('tonight: tacos, you cook');
    expect(view.tasks.items.length).toBeGreaterThan(0);
  });

  it('carries the calendar only: trips, then birthdays, then events, never a to-do', () => {
    const thu = build().snapshot.days.find((d) => d.ymd === '2026-10-16')!;
    expect(thu.view.rows.map((r) => [r.kind, r.title])).toEqual([
      ['trip', 'lake trip · day 2 of 4'],
      ['birthday', "Jo's birthday"],
    ]);
    const json = JSON.stringify(build().snapshot.days.map((d) => d.view.rows));
    expect(json).not.toContain('pack swim bag');
  });

  it("starts a trip on its first day for the look-ahead, and pins a running trip to today's only", () => {
    const days = build().snapshot.days;
    const trip = (ymd: string) =>
      days.find((d) => d.ymd === ymd)!.view.rows.find((r) => r.kind === 'trip');
    expect(trip('2026-10-14')).toBeUndefined();
    expect(trip('2026-10-15')).toMatchObject({
      title: 'lake trip · starts',
      titleEmphasis: 'starts',
      todayOnly: false,
    });
    expect(trip('2026-10-16')).toMatchObject({ title: 'lake trip · day 2 of 4', todayOnly: true });
  });

  it("shows another adult's trip on an adult's widget, but not on a child's", () => {
    const solo = {
      ...LAKE_TRIP,
      id: 'solo',
      name: 'work trip',
      assigneeIds: ['jo'],
    } as FamilyVacation;
    const days = build({ vacations: [solo] }).snapshot.days;
    expect(days.some((d) => d.view.rows.some((r) => r.kind === 'trip'))).toBe(true);
    const child = build({ vacations: [solo], currentMember: AVA }).snapshot.days;
    expect(child.some((d) => d.view.rows.some((r) => r.kind === 'trip'))).toBe(false);
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
    const rows = today(s).view.rows;
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
    const byTitle = new Map(today(s).view.rows.map((r) => [r.title, r.isDone]));
    expect(byTitle.get("Carter's party")).toBe(true);
    expect(byTitle.get('soccer practice')).toBe(false);
    expect(byTitle.get('swimming lesson at Tampines pool')).toBe(false);
  });

  it('writes the handoff as "drives" for one driver and as a line for two', () => {
    const rows = today(build().snapshot).view.rows;
    expect(rows.find((r) => r.title === 'piano')?.handoff).toEqual({
      inlineTitle: 'piano, Jo drives',
      avatars: [],
    });
    expect(rows.find((r) => r.title === "Carter's party")?.handoff).toEqual({
      line: 'Sam drops off, Jo picks up 12:30pm',
      avatars: ['father', 'mother'],
    });
  });

  it("lists the viewer's own pick-ups, never another adult's", () => {
    const s = build().snapshot;
    expect(today(s).view.pickups).toEqual([
      { at: new Date(2026, 9, 11, 18, 30).getTime(), text: 'pick-up 6:30pm, Max' },
    ]);
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
    expect(today(s).view.pickups.map((p) => p.text)).toEqual(['pick-up 3pm']);
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
    expect(today(s).view.pickups.map((p) => p.text)).toEqual(['pick-up 3pm, Max']);
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
    expect(titles(today(on('2026-10-11')).view)).toEqual([]);
    expect(titles(today(on('2026-10-10')).view)).toEqual(['drive to the lake']);
  });

  it('carries the whole look-ahead, each day with its divider date', () => {
    const s = build().snapshot;
    expect(s.days.map((d) => d.ymd)).toEqual(daysFrom(TODAY));
    expect(s.days[1]).toMatchObject({ weekday: 'Monday', numeral: '12', dividerDate: 'Mon 12' });
    expect(titles(s.days[1]!.view)).toEqual(["lunch at grandma's", 'playdate']);
    expect(titles(s.days[3]!.view)).toEqual(["parents' evening"]);
  });
});

describe('buildWidgetSnapshot: the to-dos section', () => {
  const tasks = (d: WidgetDay) => d.tasks.items.map((i) => [i.kind, i.title, i.tag, i.tagTone]);

  it('ranks to-dos, hints and lists together by when they are due, never by kind', () => {
    // Sam's view: the overdue candles; today, the timed swim bag, then Ava's library book and
    // the gift hint (a hint ranks exactly like a to-do); later this week, the groceries list
    // (tomorrow, shown early by its rule) and the plumber (Thursday). Jo's passports and Max's meds list are another
    // adult's, so (as on the briefing) they never show.
    expect(tasks(today(build().snapshot).view)).toEqual([
      ['todo', 'buy birthday candles', 'overdue', 'accent'],
      ['todo', 'pack swim bag', 'by 5pm', 'accent'],
      ['todo', 'return library book', 'today', 'accent'],
      ['hint', "wrap a gift for Carter's party", 'today', 'accent'],
      ['list', 'groceries, 2 left', 'Mon 12', 'soft'],
      ['todo', 'call the plumber', 'Thu 15', 'soft'],
    ]);
  });

  it('counts what is due now, never what is undated or later this week', () => {
    const renew = todo({ id: 'renew', title: "renew Ava's passport", assigneeIds: ['sam'] });
    const tasks = today(
      build({ todos: [SWIM_BAG, PASSPORTS, CANDLES, LIBRARY, PLUMBER, GIFT_HINT, renew] }).snapshot
    ).view.tasks;
    // Hints are listed but not counted: the count is what the `due` switch shows. The undated
    // to-do is listed but not counted either (v4: the "for you today" count is gone).
    expect(tasks.items.map((i) => i.title)).toContain("renew Ava's passport");
    expect(tasks.count).toBe(3);
    expect(tasks.countText).toEqual({ text: '3 due today', emphasis: '3' });
    expect(tasks.heading).toBe('to-dos and lists');
  });

  it('builds each day as if it were today, so the order holds after midnight', () => {
    const tomorrow = build().snapshot.days[1]!.view.tasks.items;
    expect(tomorrow.find((i) => i.kind === 'list')).toMatchObject({
      bucket: 'today',
      tag: 'today',
    });
    expect(tomorrow[0]).toMatchObject({ title: 'buy birthday candles', bucket: 'overdue' });
  });

  it('shows an undated to-do of mine with no tag, after today and before later', () => {
    const renew = todo({ id: 'renew', title: "renew Ava's passport", assigneeIds: ['sam'] });
    const items = today(build({ todos: [renew, PLUMBER], hintTodos: [], lists: [] }).snapshot).view
      .tasks.items;
    expect(items.map((i) => [i.title, i.bucket, i.tag])).toEqual([
      ["renew Ava's passport", 'undated', ''],
      ['call the plumber', 'later', 'Thu 15'],
    ]);
  });

  // greg, 2026-11-06 / 2026-11-10: a child's routine stays off a parent's widget while on track,
  // exactly as on the briefing (`gateRoutine`); the opt-in or a missed to-do brings it back.
  describe("a child's routine on a parent's widget", () => {
    const DAILY = { unit: 'day', interval: 1, end: { kind: 'never' } } as const;
    const plants = (over: Partial<TodoItem> = {}) =>
      todo({
        id: 'plants',
        title: 'water the plants',
        assigneeIds: ['ava'],
        dueDate: TODAY,
        repeat: { rule: DAILY, anchor: TODAY } as TodoItem['repeat'],
        repeatLog: [],
        ...over,
      });
    const chores = (over: Partial<FamilyList> = {}): FamilyList =>
      ({
        ...MEDS_LIST,
        id: 'chores',
        title: 'morning chores',
        ownerId: 'ava',
        category: 'kids',
        lifecycle: 'recurring',
        frequency: 'daily',
        cadence: undefined,
        createdAt: TODAY,
        lastResetDate: TODAY,
        items: [{ id: 'c1', title: 'teeth', completed: false }],
        ...over,
      }) as FamilyList;
    const myTitles = (over: Partial<WidgetSnapshotInput>) =>
      today(build({ hintTodos: [], ...over }).snapshot).view.tasks.items.map((i) => i.title);
    const titlesByDay = (over: Partial<WidgetSnapshotInput>) =>
      build({ hintTodos: [], ...over }).snapshot.days.map((d) =>
        d.view.tasks.items.map((i) => i.title)
      );

    it('excludes an on-track repeating to-do and recurring list, on every widget day', () => {
      expect(titlesByDay({ todos: [plants()], lists: [chores()] })).toEqual(
        Array.from({ length: WIDGET_DAYS }, () => [])
      );
    });

    it('includes them with notifyParents, on every widget day', () => {
      for (const titles of titlesByDay({
        todos: [plants({ notifyParents: true })],
        lists: [chores({ notifyParents: true })],
      })) {
        expect(titles).toEqual(
          expect.arrayContaining(['water the plants', 'morning chores, 1 left'])
        );
      }
    });

    // A repeating to-do whose date has not been rolled forward yet reads as overdue: missed, so
    // a parent sees it today. Days 2-7 are projections, never missed, so it stays off them.
    it('includes a missed repeating to-do today only, never on the projected days', () => {
      const missed = plants({ dueDate: '2026-10-10' });
      const [first, ...rest] = titlesByDay({ todos: [missed], lists: [] });
      expect(first).toEqual(['water the plants']);
      for (const titles of rest) expect(titles).toEqual([]);
    });

    // A recurring list never reads as overdue (`isListDue`), so it has no missed case: only
    // notifyParents brings it to a parent. A child's one-off list is not a routine at all.
    it("a recurring list is never missed; a child's one-off list always shows", () => {
      const lapsed = chores({ lastResetDate: '2026-10-05' });
      expect(titlesByDay({ todos: [], lists: [lapsed] }).flat()).toEqual([]);
      const oneOff = chores({ lifecycle: 'oneoff', dueDate: '2026-10-09', frequency: undefined });
      expect(myTitles({ todos: [], lists: [oneOff] })).toEqual(['morning chores, 1 left']);
    });

    it("a child's one-off to-do is unchanged", () => {
      expect(
        myTitles({ todos: [plants({ repeat: undefined, repeatLog: undefined })], lists: [] })
      ).toEqual(['water the plants']);
    });

    it("the child's own day is unchanged (a child session publishes no to-dos)", () => {
      const { snapshot } = build({ currentMember: AVA, todos: [plants()], lists: [chores()] });
      expect(today(snapshot).view.tasks.items).toEqual([]);
    });
  });

  describe('repeating lists', () => {
    // Anchored on TODAY, so every-2-days resets on entries 0, 2, 4, 6 (the 11th, 13th, 15th, 17th).
    const repeating = (over: Partial<FamilyList> = {}): FamilyList =>
      ({
        ...MEDS_LIST,
        id: 'rep',
        title: 'rounds',
        ownerId: 'sam',
        category: 'home',
        cadence: { unit: 'day', interval: 2 },
        createdAt: TODAY,
        lastResetDate: TODAY,
        items: [
          { id: 'r1', title: 'a', completed: true },
          { id: 'r2', title: 'b', completed: false },
          { id: 'r3', title: 'c', completed: false },
        ],
        ...over,
      }) as FamilyList;
    const listRow = (s: WidgetSnapshot, i: number) =>
      s.days[i]!.view.tasks.items.find((r) => r.kind === 'list');

    it('is a today row with the open count on the day it reset, then on each reset day only', () => {
      const s = build({ lists: [repeating()], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toMatchObject({ title: 'rounds, 2 left', bucket: 'today' });
      // Between resets it waits (the list default: its due day, a repeating list's being its
      // reset day). Before plan 2026-11-13 these entries carried it as `later`.
      for (const i of [1, 3, 5]) expect(listRow(s, i)).toBeUndefined();
      for (const i of [2, 4, 6]) {
        expect(listRow(s, i)).toMatchObject({ title: 'rounds, 3 left', bucket: 'today' });
      }
    });

    it('is later between resets under Every Day, counting the round in progress', () => {
      const s = build({ lists: [repeating({ showOn: 'now' })], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toMatchObject({ title: 'rounds, 2 left', bucket: 'today' });
      // The 12th belongs to the round that began today; the 14th, 16th to later rounds.
      expect(listRow(s, 1)).toMatchObject({ title: 'rounds, 2 left', bucket: 'later' });
      for (const i of [3, 5]) {
        expect(listRow(s, i)).toMatchObject({ title: 'rounds, 3 left', bucket: 'later' });
      }
    });

    it('shows a weekly list early by Days Before, counting every item of the next round', () => {
      // Weekly on Mondays; the next reset is Monday the 12th, so a 1-day lead opens today.
      const weekly = repeating({
        cadence: { unit: 'week', interval: 1, weekdays: [1] },
        createdAt: '2026-10-05',
        lastResetDate: '2026-10-05',
        showLeadDays: 1,
      });
      const s = build({ lists: [weekly], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toMatchObject({ title: 'rounds, 3 left', bucket: 'later' });
      expect(listRow(s, 1)).toMatchObject({ title: 'rounds, 3 left', bucket: 'today' });
      const plain = build({
        lists: [{ ...weekly, showLeadDays: undefined }],
        todos: [],
        hintTodos: [],
      }).snapshot;
      expect(listRow(plain, 0)).toBeUndefined();
    });

    it('shows a daily list as today on every entry', () => {
      const daily = repeating({ cadence: undefined, frequency: 'daily' });
      const s = build({ lists: [daily], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toMatchObject({ title: 'rounds, 2 left', bucket: 'today' });
      for (let i = 1; i < WIDGET_DAYS; i++) {
        expect(listRow(s, i)).toMatchObject({ title: 'rounds, 3 left', bucket: 'today' });
      }
    });

    it('a finished round is off today and predicts the NEXT reset, not today again', () => {
      const done = repeating({
        cadence: undefined,
        frequency: 'daily',
        items: [{ id: 'r1', title: 'a', completed: true }],
      });
      const s = build({ lists: [done], todos: [], hintTodos: [] }).snapshot;
      // Today's round is done, so today's entry carries nothing (tomorrow's reset waits for
      // its day); tomorrow's entry is that reset, every item unticked.
      expect(listRow(s, 0)).toBeUndefined();
      expect(listRow(s, 1)).toMatchObject({ title: 'rounds, 1 left', bucket: 'today' });
    });

    it('is not today on the day after its reset: waiting by default, later under Every Day', () => {
      const dayAfter = repeating({ createdAt: '2026-10-10', lastResetDate: '2026-10-10' });
      const s = build({ lists: [dayAfter], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toBeUndefined();
      const now = build({
        lists: [{ ...dayAfter, showOn: 'now' }],
        todos: [],
        hintTodos: [],
      }).snapshot;
      expect(listRow(now, 0)).toMatchObject({ title: 'rounds, 2 left', bucket: 'later' });
    });

    it('is never overdue or undated on any entry', () => {
      const lists = [repeating(), repeating({ id: 'rep2', lastResetDate: '2026-10-10' })];
      const s = build({ lists, todos: [], hintTodos: [] }).snapshot;
      for (const day of s.days) {
        const buckets = day.view.tasks.items.map((r) => r.bucket);
        expect(buckets).not.toContain('overdue');
        expect(buckets).not.toContain('undated');
      }
    });

    it("follows the briefing's owner audience: my private list shows, another adult's never", () => {
      const s = build({
        lists: [repeating({ ownerId: 'jo' }), repeating({ id: 'priv', category: 'health' })],
        todos: [],
        hintTodos: [],
      }).snapshot;
      s.days.forEach((day, i) => {
        // Reset days only (entries 0, 2, 4, 6); the waiting days carry no list at all.
        expect(day.view.tasks.items.filter((r) => r.kind === 'list').map((r) => r.id)).toEqual(
          i % 2 === 0 ? ['list:priv'] : []
        );
      });
    });

    it('shows a list for two assignees to both, with both as its owners', () => {
      const shared = repeating({ ownerId: 'jo', assigneeIds: ['jo', 'sam'] });
      const s = build({ lists: [shared], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(s, 0)).toMatchObject({ id: 'list:rep', title: 'rounds, 2 left' });
      const jo = build({ currentMember: JO, lists: [shared], todos: [], hintTodos: [] }).snapshot;
      expect(listRow(jo, 0)).toMatchObject({ id: 'list:rep' });
    });
  });

  it('keeps a one-off list off until its due day by default (no look-ahead)', () => {
    const plain = { ...GROCERIES, id: 'plain', showOn: undefined } as FamilyList;
    const waiting = {
      ...GROCERIES,
      id: 'waiting',
      showOn: undefined,
      dueDate: '2026-10-16',
      showFrom: '2026-10-14',
    } as FamilyList;
    const s = build({ todos: [], lists: [plain, waiting], hintTodos: [] }).snapshot;
    const ids = (i: number) => s.days[i]!.view.tasks.items.map((r) => r.id);
    expect(ids(0)).toEqual([]);
    expect(ids(1)).toEqual(['list:plain']);
    // A "Show from" brings it early: the 14th and 15th as `later`, the 16th as today.
    expect(ids(3)).toEqual(['list:plain', 'list:waiting']);
    expect(s.days[3]!.view.tasks.items[1]).toMatchObject({ bucket: 'later' });
    expect(s.days[5]!.view.tasks.items.find((r) => r.id === 'list:waiting')).toMatchObject({
      bucket: 'today',
    });
  });

  it("leaves out an emptied list and another adult's list", () => {
    const empty = { ...GROCERIES, id: 'empty', title: 'empty', items: [] } as FamilyList;
    const jos = { ...GROCERIES, id: 'jos', title: "Jo's list", ownerId: 'jo' } as FamilyList;
    const s = build({ todos: [], lists: [empty, jos], hintTodos: [] }).snapshot;
    expect(today(s).view.tasks.items).toEqual([]);
  });

  // "Show from": a to-do has no look-ahead; it shows until it is done, unless its show date is
  // still ahead. One due beyond the look-ahead names its month.
  it('shows a to-do due past the look-ahead, tagged with its month', () => {
    const far = todo({ id: 'far', title: 'far off', assigneeIds: ['sam'], dueDate: '2026-10-30' });
    const s = build({ todos: [far], lists: [], hintTodos: [] }).snapshot;
    expect(today(s).view.tasks.items).toEqual([
      expect.objectContaining({ title: 'far off', bucket: 'later', tag: 'Oct 30' }),
    ]);
  });

  it('leaves a to-do off every day before its show date, and on from that day', () => {
    const later = todo({
      id: 'later',
      title: 'renew insurance',
      assigneeIds: ['sam'],
      dueDate: '2026-10-30',
      showFrom: '2026-10-14',
    });
    const s = build({ todos: [later], lists: [], hintTodos: [] }).snapshot;
    const titlesOn = (ymd: string) =>
      s.days.find((d) => d.ymd === ymd)!.view.tasks.items.map((i) => i.title);
    expect(titlesOn(TODAY)).toEqual([]);
    expect(titlesOn('2026-10-13')).toEqual([]);
    expect(titlesOn('2026-10-14')).toEqual(['renew insurance']);
  });

  it("a child's repeating chore stays off a parent's widget on every day, including after its due day", () => {
    const daily = {
      rule: { unit: 'day', interval: 1, end: { kind: 'never' } },
      anchor: '2026-10-01',
    } as TodoItem['repeat'];
    const chore = todo({
      id: 'chore',
      title: 'feed the fish',
      assigneeIds: ['ava'],
      repeat: daily,
      repeatLog: [],
      dueDate: TODAY,
    });
    const s = build({ todos: [chore], lists: [], hintTodos: [] }).snapshot;
    // Days 2-7 are projected: the chore due today would read as overdue there, but is not missed.
    for (const day of s.days) expect(day.view.tasks.items).toEqual([]);
    // Kept posted: on the parent's widget from its due day (and, as a projection, after it).
    const posted = build({
      todos: [{ ...chore, notifyParents: true }],
      lists: [],
      hintTodos: [],
    }).snapshot;
    expect(today(posted).view.tasks.items.map((i) => i.title)).toEqual(['feed the fish']);
  });

  it('turns a timed to-do overdue once its time has passed today, never on a later day', () => {
    const local = new Date(2026, 9, 11, 18, 0); // 18:00 device-local on TODAY
    const timed = todo({
      id: 'timed',
      title: 'call the plumber',
      assigneeIds: ['sam'],
      dueDate: TODAY,
      dueTime: '17:00',
    });
    const at = (now: Date) =>
      buildWidgetSnapshot(familyInput({ todos: [timed], lists: [], hintTodos: [] }), now).snapshot;
    expect(today(at(local)).view.tasks.items[0]).toMatchObject({ bucket: 'overdue' });
    expect(today(at(new Date(2026, 9, 11, 16, 0))).view.tasks.items[0]).toMatchObject({
      bucket: 'today',
    });
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
    expect(today(s).view.tasks.items).toEqual([
      expect.objectContaining({ kind: 'hint', bucket: 'undated', tag: '', timed: false }),
    ]);
    expect(today(s).view.tasks.count).toBe(0);
    const onTheDay = s.days.find((d) => d.ymd === '2026-10-17')!.view.tasks.items[0];
    expect(onTheDay).toMatchObject({ bucket: 'today', tag: 'today' });
  });

  it('caps a day at MAX_WIDGET_TASKS and says how many there were', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      todo({ id: `t${i}`, title: `to-do ${i}`, assigneeIds: ['sam'], dueDate: TODAY })
    );
    const tasks = today(build({ todos: many, lists: [], hintTodos: [] }).snapshot).view.tasks;
    expect(tasks.items).toHaveLength(MAX_WIDGET_TASKS);
    expect(tasks.overflow).toEqual({ due: 30 - MAX_WIDGET_TASKS, hint: 0 });
    expect(tasks.count).toBe(30);
  });

  it('caps hints separately, so a long to-do list never crowds them out', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      todo({ id: `t${i}`, title: `to-do ${i}`, assigneeIds: ['sam'], dueDate: '2026-10-01' })
    );
    const gift = hint({ id: 'g', title: 'wrap the gift', hintEventDate: '2026-10-13' });
    const tasks = today(build({ todos: many, lists: [], hintTodos: [gift] }).snapshot).view.tasks;
    expect(tasks.items.filter((i) => i.kind === 'hint').map((i) => i.title)).toEqual([
      'wrap the gift',
    ]);
    expect(tasks.overflow).toEqual({ due: 4, hint: 0 });
    expect(tasks.heading).toBe('to-dos');
  });

  it("puts its owner's dot on every to-do and list (the family's when unowned), none on a hint", () => {
    const shared = todo({ id: 'shared', title: 'book the plumber', dueDate: TODAY });
    const items = today(build({ todos: [SWIM_BAG, CANDLES, GIFT_HINT, shared] }).snapshot).view
      .tasks.items;
    const dot = (title: string) => items.find((i) => i.title === title)?.dot;
    expect(dot('pack swim bag')).toMatchObject({ kind: 'member', initial: 'M' });
    expect(dot('buy birthday candles')).toMatchObject({ kind: 'member', initial: 'S' });
    expect(dot('book the plumber')).toEqual({ kind: 'family' });
    expect(dot("wrap a gift for Carter's party")).toBeNull();
  });
});

describe('buildWidgetSnapshot: failure isolation and links', () => {
  it('a throwing block empties only that block and counts it as skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const malformed = [null as unknown as MealPlanEntry];
    const { snapshot, skipped } = build({ mealsByDate: { [TODAY]: malformed, [TOMORROW]: [] } });
    // One malformed meal on today: the meals block of today's one view.
    expect(skipped).toBe(1);
    expect(today(snapshot).view.tonight).toBeNull();
    expect(today(snapshot).view.rows.length).toBeGreaterThan(0);
    expect(today(snapshot).view.tasks.items.length).toBeGreaterThan(0);
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

  it('opens the calendar Day view: event rows on their date, the date column on today', () => {
    const s = build().snapshot;
    const events = today(s).view.rows.filter((r) => r.kind === 'event');
    expect(events.length).toBeGreaterThan(0);
    for (const row of events) {
      expect(row.link).toBe(`${ORIGIN}/activities?view=day&d=${TODAY}&src=widget`);
    }
    for (const h of today(s).view.handoffs ?? []) {
      expect(h.link).toBe(`${ORIGIN}/activities?view=day&d=${TODAY}&src=widget`);
    }
    expect(s.links.nook).toBe(`${ORIGIN}/activities?view=day&src=widget`);
  });

  it('keeps the item links for to-dos, lists, trips and birthdays', () => {
    const links = (kind: string) =>
      s.days.flatMap((d) => d.view.rows).filter((r) => r.kind === kind);
    const s = build().snapshot;
    for (const row of links('birthday')) expect(row.link).toContain('/family?edit=');
    for (const row of links('trip')) expect(row.link).toContain('/travel?vacation=');
    expect(s.links.todo).toContain('/todo');
  });

  it('links the meal planner only while its flag is on', () => {
    const off = build({ flags: { mealPlanner: false, helpfulHints: true } }).snapshot;
    expect(today(off).view.tonight).toBeNull();
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
    expect(titles(today(snapshot).view).length).toBeGreaterThan(0);
  });
});

describe('buildWidgetSnapshot: v3 handoffs', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 11, h, m).getTime();

  it("lists the viewer's own drop-offs and pick-ups, both kinds", () => {
    const s = build().snapshot;
    const partyLink = today(s).view.rows.find((r) => r.title === "Carter's party")!.link;
    expect(today(s).view.handoffs).toEqual([
      { at: at(10, 15), kind: 'dropoff', name: 'Max', link: partyLink },
      {
        at: at(18, 30),
        kind: 'pickup',
        name: 'Max',
        link: today(s).view.rows.find((r) => r.title === 'soccer practice')!.link,
      },
    ]);
  });

  it("never lists another adult's duties", () => {
    const jo = build({ currentMember: JO }).snapshot;
    expect(today(jo).view.handoffs!.map((h) => [h.kind, h.at, h.name])).toEqual([
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
    const tasks = today(s).view.tasks;
    expect(tasks.doneToday).toBe(2);
    expect(tasks.count).toBe(before.view.tasks.count);
    expect(tasks.items.map((i) => i.title)).toEqual(before.view.tasks.items.map((i) => i.title));
    expect(build().snapshot.days[0]!.view.tasks.doneToday).toBe(0);
  });
});

describe('buildWidgetSnapshot: v3 row words', () => {
  it('gives each row its first word, in English and in Chinese', () => {
    const rows = today(build().snapshot).view.rows;
    expect(rows.find((r) => r.title.startsWith('swimming'))?.shortTitle).toBe('swimming');
    expect(rows.find((r) => r.title === "Carter's party")?.shortTitle).toBe("Carter's");

    const title = '游泳课在淡马锡';
    const swim = activity({ ...SWIM, title });
    const zh = today(
      build({ language: 'zh', occurrencesByDate: { [TODAY]: [occ(swim)], [TOMORROW]: [] } })
        .snapshot
    ).view.rows[0]!;
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
    ).view.rows;
    expect(rows.find((r) => r.id.startsWith('duo'))).toMatchObject({
      who: 'Ava & Max',
      whoFirst: 'Ava',
    });
    expect(rows.find((r) => r.id.startsWith('family'))?.whoFirst).toBe('');
  });
});

describe('buildWidgetSnapshot: chore rows (#146)', () => {
  const STARTS = { morning: '06:00', afternoon: '12:00', evening: '17:00' };
  const BEANS = ['sam', 'jo', 'ava', 'max'];
  function chore(id: string, assigneeIds: string[], extra: Partial<Chore> = {}): Chore {
    return {
      id,
      title: id,
      emoji: '🧹',
      assigneeIds,
      block: 'morning',
      sortOrder: 0,
      createdBy: 'sam',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...extra,
    } as Chore;
  }
  function done(memberId: string, ref: string): ChoreMark {
    return {
      id: `done:${memberId}:${TODAY}:${ref}`,
      kind: 'done',
      memberId,
      date: TODAY,
      ref,
      by: memberId,
      createdAt: `${TODAY}T00:10:00.000Z`,
      updatedAt: `${TODAY}T00:10:00.000Z`,
    };
  }
  const CHORES = [
    chore('sam-1', ['sam']),
    chore('sam-2', ['sam']),
    chore('ava-1', ['ava'], { notifyParents: true }),
    chore('ava-2', ['ava'], { notifyParents: true }),
    chore('max-1', ['max']),
  ];
  const withChores = (marks: ChoreMark[] = [], now: Date = NOW, chores = CHORES) =>
    buildWidgetSnapshot(
      familyInput({ chores: { chores, marks, starts: STARTS, beanIds: BEANS } }),
      now
    ).snapshot;
  const choreRows = (s: WidgetSnapshot, i = 0) =>
    s.days[i]!.view.tasks.items.filter((r) => r.kind === 'chore');

  it('adds one row per bean the viewer may follow, by the briefing’s rule', () => {
    const rows = choreRows(withChores([done('ava', 'ava-1')]));
    // Sam's own and Ava's (kept posted); never Max's on-track chore.
    expect(rows.map((r) => r.id)).toEqual(['chore:sam', 'chore:ava']);
    expect(rows[0]).toEqual({
      id: 'chore:sam',
      kind: 'chore',
      bucket: 'today',
      title: 'Sam · 2 left',
      tag: 'morning',
      tagTone: 'accent',
      timed: false,
      dot: expect.objectContaining({ kind: 'member', color: '#3b82f6' }),
      link: `${ORIGIN}/nook?src=widget`,
    });
    expect(rows[1]).toMatchObject({ title: 'Ava · 1 left', tag: 'morning' });
  });

  it('a bean with nothing left reads "done" in the soft tone', () => {
    const rows = choreRows(withChores([done('sam', 'sam-1'), done('sam', 'sam-2')]));
    expect(rows[0]).toMatchObject({ id: 'chore:sam', title: 'Sam · done', tagTone: 'soft' });
  });

  it('a missed child chore reaches the parent as overdue', () => {
    // 1 pm local on the day: Morning has ended, Max's chore is undone.
    const rows = choreRows(withChores([], new Date(2026, 9, 11, 13, 0)));
    const max = rows.find((r) => r.id === 'chore:max');
    expect(max).toMatchObject({ title: 'Max · 1 left', bucket: 'overdue', tag: 'overdue' });
  });

  it('shows chores on today only, and never counts them as due', () => {
    const plain = build().snapshot;
    const s = withChores();
    expect(s.days.slice(1).every((d) => d.view.tasks.items.every((r) => r.kind !== 'chore'))).toBe(
      true
    );
    expect(today(s).view.tasks.count).toBe(today(plain).view.tasks.count);
    expect(today(s).view.tasks.doneToday).toBe(today(plain).view.tasks.doneToday);
  });

  it('a child’s widget stays their calendar: no chore rows', () => {
    const s = buildWidgetSnapshot(
      familyInput({
        currentMember: AVA,
        chores: { chores: CHORES, marks: [], starts: STARTS, beanIds: BEANS },
      }),
      NOW
    ).snapshot;
    expect(s.days.every((d) => d.view.tasks.items.length === 0)).toBe(true);
  });

  it('no chores input (the flag off) is today’s snapshot exactly, at the same version', () => {
    expect(build({ chores: null }).snapshot).toEqual(build().snapshot);
    expect(withChores([], NOW, []).days).toEqual(build().snapshot.days);
    expect(withChores().version).toBe(4);
  });
});
