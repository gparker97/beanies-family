import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { MEMBERS, setDark } from './monthGridFixture';

/**
 * NOT a test: baseline screenshots of today's month view (desktop grid + mobile stream) for
 * the month-grid issue mockup (greg, 2026-11-04). Outside `e2e/specs/` on purpose.
 *   npx playwright test -c playwright.design.config.ts --grep "month grid baseline"
 */
const SHOTS = 'scratch-shots/month-grid-baseline';

function ymdOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

test.describe('design screenshots', () => {
  test('month grid baseline', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoRoot(page);
    const db = new IndexedDBHelper(page);
    await db.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);
    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    const now = new Date();
    const Y = now.getFullYear();
    const M = now.getMonth();
    const at = now.toISOString();
    const act = (
      i: number,
      t: string,
      c: string,
      d: number,
      s: string,
      e: string,
      w: string[],
      extra: Record<string, unknown> = {}
    ) => ({
      id: `mg-a-${i}`,
      title: t,
      category: c,
      date: ymdOf(Y, M, d),
      startTime: s,
      endTime: e,
      isAllDay: false,
      assigneeIds: w,
      recurrence: 'none',
      isActive: true,
      createdAt: at,
      updatedAt: at,
      ...extra,
    });
    const activities = [
      act(1, 'Football training', 'football', 3, '16:00', '17:30', ['m-leo']),
      act(2, 'Swimming', 'swimming', 3, '16:30', '17:30', ['m-milo']),
      act(3, 'Piano', 'music', 4, '15:30', '16:15', ['m-theo']),
      act(4, 'Dentist', 'other_appointment', 5, '11:00', '11:45', ['m-theo']),
      act(5, 'Book club', 'other_appointment', 5, '19:30', '20:45', ['m-sofia']),
      act(6, 'Parent evening', 'other_school', 6, '18:00', '19:00', ['m-greg', 'm-sofia']),
      act(7, 'Grandma visits', 'other_social', 7, '11:00', '14:00', []),
      act(8, 'Football match', 'football', 10, '09:00', '10:30', ['m-leo']),
      act(9, 'Swimming', 'swimming', 10, '16:30', '17:30', ['m-milo']),
      act(10, 'Piano', 'music', 11, '15:30', '16:15', ['m-theo']),
      act(11, 'School trip', 'other_school', 12, '08:00', '15:00', ['m-leo', 'm-milo']),
      act(12, 'Food shop', 'other_errand', 12, '18:00', '19:00', ['m-sofia']),
      act(13, 'Doctor', 'other_appointment', 13, '09:30', '10:00', ['m-milo']),
      act(14, 'Date night', 'other_social', 14, '19:00', '22:00', ['m-greg', 'm-sofia']),
      act(15, 'Birthday party (Sam)', 'birthday', 15, '14:00', '16:00', ['m-theo']),
      act(16, 'Football training', 'football', 17, '16:00', '17:30', ['m-leo']),
      act(17, 'Swimming', 'swimming', 17, '16:30', '17:30', ['m-milo']),
      act(18, 'Piano', 'music', 18, '15:30', '16:15', ['m-theo']),
      act(19, 'Haircuts', 'other_errand', 19, '10:00', '11:30', ['m-leo', 'm-milo', 'm-theo']),
      act(20, 'Football training', 'football', 24, '16:00', '17:30', ['m-leo']),
      act(21, 'Swimming', 'swimming', 24, '16:30', '17:30', ['m-milo']),
      act(22, 'Piano recital', 'music', 26, '18:00', '19:30', ['m-theo']),
      act(23, 'Teacher training day', 'other_school', 27, '', '', ['m-leo', 'm-milo'], {
        isAllDay: true,
      }),
      act(24, 'Dentist', 'other_appointment', 3, '08:30', '09:00', ['m-greg']),
      act(25, 'Vet', 'other_errand', 3, '12:00', '12:30', ['m-sofia']),
      act(26, 'Scouts', 'other_social', 3, '18:30', '20:00', ['m-leo']),
    ];
    const trip = {
      id: 'mg-trip',
      name: 'Half-term in Bali',
      tripType: 'fly_and_stay',
      startDate: ymdOf(Y, M, 20),
      endDate: ymdOf(Y, M, 25),
      assigneeIds: MEMBERS.map((m) => m.id),
      travelSegments: [],
      accommodations: [],
      transportation: [],
      ideas: [],
      createdBy: 'm-greg',
      createdAt: at,
      updatedAt: at,
    };
    const seeded = await page.evaluate(
      async ({ members, activities, trip, at }) => {
        const bridge = (
          window as unknown as { __e2eDataBridge?: { seedData: (d: unknown) => Promise<void> } }
        ).__e2eDataBridge;
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
        return { ok: true };
      },
      { members: MEMBERS, activities, trip, at }
    );
    if ('error' in seeded) throw new Error(`seeding failed: ${seeded.error}`);
    await page.waitForTimeout(1500);

    for (const [w, h, name] of [
      [1280, 800, 'desktop'],
      [390, 844, 'phone'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await gotoRoute(page, '/activities?view=month');
      await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(1200);
      for (const dark of [false, true]) {
        await setDark(page, dark);
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `${SHOTS}/month-${name}-${dark ? 'dark' : 'light'}.png`,
          fullPage: name === 'phone',
        });
      }
      await setDark(page, false);
    }
  });
});
