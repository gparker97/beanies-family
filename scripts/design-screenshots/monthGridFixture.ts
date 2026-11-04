import type { Page } from '@playwright/test';

/**
 * Shared fixture for the month-grid design-screenshot scripts (#141). NOT a test: the name does not
 * match `playwright.design.config.ts`'s `/capture\.ts/`, so Playwright never runs it directly.
 * Used by `month-grid-baseline-capture.ts` and `month-grid-capture.ts`.
 */

export const MEMBERS = [
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', ageGroup: 'adult', gender: 'male' },
  { id: 'm-sofia', name: 'Sofia', color: '#E67E22', ageGroup: 'adult', gender: 'female' },
  { id: 'm-leo', name: 'Leo', color: '#F15D22', ageGroup: 'child', gender: 'male' },
  { id: 'm-milo', name: 'Milo', color: '#3D8FD1', ageGroup: 'child', gender: 'male' },
  {
    id: 'm-theo',
    name: 'Theo',
    color: '#27AE60',
    ageGroup: 'child',
    gender: 'male',
    // Turns 6 on 15 Nov 2026: the birthday cake sits beside the 15th.
    dateOfBirth: { month: 11, day: 15, year: 2020 },
  },
];

export async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
}

const G = 'm-greg';
const S = 'm-sofia';
const L = 'm-leo';
const M = 'm-milo';
const T = 'm-theo';

/** [day, icon, title, category, 'H:mm' start, owners]. The mockup's events; its "john" is Sofia here. */
type Row = [number, string, string, string, string, string[]];

// November 2026, from the mockup's E list.
const NOVEMBER: Row[] = [
  [3, '🦷', 'Dentist', 'other_appointment', '8:30', [G]],
  [3, '🐾', 'Vet', 'other_errand', '12:00', [S]],
  [3, '🏈', 'Football', 'football', '16:00', [L]],
  [3, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [3, '🏕️', 'Scouts', 'other_social', '18:30', [L]],
  [4, '🎵', 'Piano', 'music', '15:30', [T]],
  [4, '🏃', 'Run club', 'other_social', '7:00', [G]],
  [5, '🦷', 'Dentist', 'other_appointment', '11:00', [T]],
  [5, '📚', 'Book club', 'other_social', '19:30', [S]],
  [5, '🏈', 'Football', 'football', '16:00', [L]],
  [6, '🏫', 'Parent evening', 'other_school', '18:00', [G, S]],
  [7, '👵', 'Grandma visits', 'other_social', '11:00', []],
  [10, '🏈', 'Football match', 'football', '9:00', [L]],
  [10, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [11, '🎵', 'Piano', 'music', '15:30', [T]],
  [12, '🚌', 'School trip', 'other_school', '8:00', [L, M]],
  [12, '🛒', 'Food shop', 'other_errand', '18:00', [S]],
  [12, '🏈', 'Football', 'football', '16:00', [L]],
  [13, '🩺', 'Doctor', 'other_appointment', '9:30', [M]],
  [14, '🍽️', 'Date night', 'other_social', '19:00', [G, S]],
  [15, '🎂', 'Sam’s party', 'birthday', '14:00', [T]],
  [16, '🏀', 'Basketball', 'other_social', '17:00', [M]],
  [17, '🏈', 'Football', 'football', '16:00', [L]],
  [17, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [18, '🎵', 'Piano', 'music', '15:30', [T]],
  [19, '✂️', 'Haircuts', 'other_errand', '10:00', [L, M, T]],
  [23, '🏈', 'Football', 'football', '16:00', [L]],
  [24, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [25, '🎵', 'Piano', 'music', '15:30', [T]],
  [26, '🎵', 'Piano recital', 'music', '18:00', [T]],
  [27, '🎉', 'Last day of term', 'other_school', '12:00', []],
  [28, '🏈', 'Football', 'football', '9:00', [L]],
  [30, '🏫', 'Assembly', 'other_school', '9:00', [M]],
  [2, '🏈', 'Football', 'football', '16:00', [L]],
  [2, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [1, '🧁', 'Baking', 'other_social', '10:00', [S, T]],
  [9, '🎸', 'Guitar', 'music', '17:00', [L]],
];

// Neighbouring months, for the faded padding cells.
const OCTOBER: Row[] = [
  [28, '🎵', 'Piano', 'music', '15:30', [T]],
  [29, '🏈', 'Football', 'football', '16:00', [L]],
  [31, '🎃', 'Halloween', 'other_social', '17:00', []],
];
const DECEMBER: Row[] = [
  [1, '🎄', 'Tree up', 'other_social', '15:00', []],
  [2, '🎵', 'Piano', 'music', '15:30', [T]],
  [3, '🏈', 'Football', 'football', '16:00', [L]],
  [5, '🏊', 'Swimming', 'swimming', '16:30', [M]],
  [8, '🏀', 'Basketball', 'other_social', '17:00', [M]],
  [9, '🎵', 'Piano', 'music', '15:30', [T]],
];

const ymd = (month: number, day: number) =>
  `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function hhmm(s: string): string {
  const [h, m] = s.split(':');
  return `${h!.padStart(2, '0')}:${m}`;
}

function plusMinutes(start: string, mins: number): string {
  const [h, m] = hhmm(start).split(':').map(Number);
  const t = Math.min(h! * 60 + m! + mins, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Counts of what `seedNovember2026` wrote, for the "visible versus seeded" log. */
export interface SeededCounts {
  activities: number;
  trips: number;
  members: number;
}

/**
 * Seed the November 2026 dataset through `window.__e2eDataBridge.seedData`. The page must already
 * be on an app route with a cleared family and the login bypassed (see the capture scripts).
 * Throws when the bridge is missing or when a read-back shows the seed did not land.
 */
export async function seedNovember2026(page: Page): Promise<SeededCounts> {
  const at = new Date('2026-11-04T09:00:00').toISOString();
  const activities: Record<string, unknown>[] = [];
  let n = 0;
  const base = (
    title: string,
    category: string,
    date: string,
    owners: string[],
    extra: Record<string, unknown>
  ) => ({
    id: `mg-a-${++n}`,
    title,
    category,
    date,
    isAllDay: false,
    assigneeIds: owners,
    recurrence: 'none',
    isActive: true,
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  const timed = (month: number, rows: Row[]) => {
    for (const [d, icon, title, cat, start, owners] of rows) {
      activities.push(
        base(title, cat, ymd(month, d), owners, {
          icon,
          startTime: hhmm(start),
          endTime: plusMinutes(start, 45),
        })
      );
    }
  };
  timed(10, OCTOBER);
  timed(11, NOVEMBER);
  timed(12, DECEMBER);

  // All-day, one or two days: `isAllDay` + `endDate` is how the app expresses a multi-day all-day.
  activities.push(
    base('Teacher training day', 'other_school', ymd(11, 27), [L, M], {
      icon: '🏫',
      isAllDay: true,
    })
  );
  activities.push(
    base('Grandparents staying', 'other_social', ymd(11, 9), [], {
      icon: '🏡',
      isAllDay: true,
      endDate: ymd(11, 10),
    })
  );
  // Overnight timed event: endTime before startTime rolls to the next day.
  activities.push(
    base('Sleepover', 'other_social', ymd(11, 13), [M], {
      icon: '🌙',
      startTime: '22:00',
      endTime: '02:00',
    })
  );
  // The overflow day: 59 extra items on 30 Nov, with the mockup's Assembly makes 60.
  const owners = [[G], [S], [L], [M], [T], [G, S], [L, M]];
  for (let i = 0; i < 59; i++) {
    const h = 6 + Math.floor(i / 4);
    const mm = (i % 4) * 15;
    activities.push(
      base(`Overflow item ${i + 1}`, 'other_errand', ymd(11, 30), owners[i % owners.length]!, {
        startTime: `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        endTime: `${String(h).padStart(2, '0')}:${String(mm + 10).padStart(2, '0')}`,
      })
    );
  }

  const trip = {
    id: 'mg-trip',
    name: 'Half-term in Bali',
    tripType: 'fly_and_stay',
    startDate: ymd(11, 20),
    endDate: ymd(11, 25),
    assigneeIds: MEMBERS.map((m) => m.id),
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: G,
    createdAt: at,
    updatedAt: at,
  };

  const seeded = await page.evaluate(
    async ({ members, activities, trip, at }) => {
      type Bridge = {
        seedData: (d: unknown) => Promise<void>;
        exportData: () => Record<string, unknown[]>;
      };
      const bridge = (window as unknown as { __e2eDataBridge?: Bridge }).__e2eDataBridge;
      if (!bridge) return { error: 'no bridge' };
      await bridge.seedData({
        familyMembers: members.map((m) => ({
          ...m,
          email: `${m.id}@example.invalid`,
          role: 'member',
          requiresPassword: false,
          createdAt: at,
          updatedAt: at,
        })),
        activities,
        vacations: [trip],
      });
      const out = bridge.exportData();
      return {
        members: out.familyMembers?.length ?? 0,
        activities: out.activities?.length ?? 0,
        trips: out.vacations?.length ?? 0,
      };
    },
    { members: MEMBERS, activities, trip, at }
  );
  if ('error' in seeded) throw new Error(`seeding failed: ${seeded.error}`);
  // Prove the seed landed: the projection must hold at least what was written.
  if (
    seeded.activities < activities.length ||
    seeded.trips < 1 ||
    seeded.members < MEMBERS.length
  ) {
    throw new Error(
      `seed did not land: wanted ${activities.length} activities / 1 trip / ${MEMBERS.length} members, ` +
        `projection has ${seeded.activities} / ${seeded.trips} / ${seeded.members}`
    );
  }
  await page.waitForTimeout(1500);
  return { activities: activities.length, trips: 1, members: MEMBERS.length };
}
