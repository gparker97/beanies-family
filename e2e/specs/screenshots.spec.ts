import { test } from '../fixtures/test';
import { IndexedDBHelper } from '../helpers/indexeddb';
import { bypassLoginIfNeeded } from '../helpers/auth';
import { gotoRoot, gotoRoute } from '../helpers/navigation';

/**
 * NOT a test — a screenshot harness for design review.
 *
 * Seeds a realistic family (five beans on five distinct hues) plus a week of
 * activities covering every card tier the identity change introduces: solo,
 * shared, no-owner, birthday, an errand that must NOT celebrate, two beans that
 * share a first initial, and a six-owner event for the `+n` overflow.
 *
 * Views are switched through the REAL UI rather than `page.goto`, because a
 * full reload drops the seeded Automerge doc — the first version of this file
 * navigated per view and captured six identical blank frames, and passed,
 * because a screenshot harness asserts nothing. Seed once, click through.
 *
 * Excluded from the ADR-007 E2E budget: it makes no assertions. Run it
 * deliberately:
 *   npx playwright test e2e/specs/screenshots.spec.ts --project=chromium
 */

const MEMBERS = [
  { id: 'm-greg', name: 'Greg', color: '#f59e0b', ageGroup: 'adult', gender: 'male' },
  { id: 'm-sofia', name: 'Sofia', color: '#8b5cf6', ageGroup: 'adult', gender: 'female' },
  { id: 'm-max', name: 'Max', color: '#3b82f6', ageGroup: 'child', gender: 'male' },
  { id: 'm-mia', name: 'Mia', color: '#ec4899', ageGroup: 'child', gender: 'female' },
  { id: 'm-leo', name: 'Leo', color: '#22c55e', ageGroup: 'child', gender: 'male' },
];

function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const ACTIVITIES = [
  { t: 'Dentist', c: 'dentist', s: '09:00', e: '09:45', w: ['m-leo'], d: 0 },
  { t: 'Trumpet lesson', c: 'music', s: '15:30', e: '16:15', w: ['m-sofia'], d: 0 },
  { t: 'Swimming', c: 'swimming', s: '16:30', e: '17:30', w: ['m-max'], d: 0 },
  { t: 'Swim run', c: 'swimming', s: '17:45', e: '18:30', w: ['m-sofia', 'm-max'], d: 0 },
  { t: 'Pizza night', c: 'dining_out', s: '19:00', e: '20:00', w: [], d: 0 },
  { t: "Leo's birthday", c: 'birthday', s: undefined, e: undefined, w: ['m-leo'], d: 0 },
  {
    t: 'Football training',
    c: 'football',
    s: '10:00',
    e: '11:30',
    w: ['m-max', 'm-leo', 'm-mia'],
    d: 1,
  },
  { t: 'Buy birthday present', c: 'shopping', s: '12:00', e: '12:30', w: ['m-greg'], d: 1 },
  { t: 'Cinema', c: 'cinema', s: '19:00', e: '21:00', w: MEMBERS.map((m) => m.id), d: 1 },
  { t: 'Ballet', c: 'dance', s: '14:00', e: '15:00', w: ['m-mia'], d: 2 },
  {
    t: 'Our anniversary',
    c: 'anniversary',
    s: undefined,
    e: undefined,
    w: ['m-greg', 'm-sofia'],
    d: 3,
  },
  { t: 'Piano', c: 'piano', s: '16:00', e: '16:45', w: ['m-mia'], d: 2 },
];

test.describe('design screenshots', () => {
  test('planner views with member-coloured cards', async ({ page }) => {
    test.setTimeout(240_000);

    await gotoRoot(page);
    const db = new IndexedDBHelper(page);
    await db.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    const now = new Date().toISOString();
    const seedResult = await page.evaluate(
      async ({ members, activities, stamp }) => {
        const bridge = (
          window as unknown as {
            __e2eDataBridge?: {
              seedData: (d: unknown) => Promise<void>;
              exportData: () => Record<string, unknown[]>;
            };
          }
        ).__e2eDataBridge;
        if (!bridge) return { error: 'no bridge' };
        await bridge.seedData({
          familyMembers: members.map((m) => ({
            ...m,
            email: `${m.id}@example.invalid`,
            role: 'member',
            requiresPassword: false,
            createdAt: stamp,
            updatedAt: stamp,
          })),
          activities: activities.map((a, i) => ({
            id: `act-${i}`,
            title: a.t,
            category: a.c,
            date: a.date,
            ...(a.s ? { startTime: a.s, endTime: a.e } : { isAllDay: true }),
            assigneeIds: a.w,
            recurrence: 'none',
            // Required: `activeActivities` filters on it, so a seeded activity without
            // it is in the document, in the store, and invisible everywhere.
            isActive: true,
            createdAt: stamp,
            updatedAt: stamp,
          })),
        });
        const d = bridge.exportData();
        return { members: d.familyMembers?.length ?? 0, activities: d.activities?.length ?? 0 };
      },
      {
        members: MEMBERS,
        activities: ACTIVITIES.map((a) => ({ ...a, date: ymd(a.d) })),
        stamp: now,
      }
    );
    if ((seedResult as { error?: string }).error) throw new Error(String(seedResult));

    // `seedData` writes the Automerge DOC; the Pinia stores are a projection of it and
    // do not re-derive on their own. Demo mode hits exactly this and calls
    // `syncStore.reloadAllStores()` (demoSeed.ts:233) — the same step, for the same
    // reason. Without it the members appeared (they load on a later path) while every
    // activity stayed invisible, which is what an empty calendar over a doc holding
    // twelve of them looks like.
    await page.evaluate(async () => {
      const w = window as unknown as { __pinia?: unknown };
      const mod = await import('/src/stores/syncStore.ts');
      await (mod as { useSyncStore: () => { reloadAllStores: () => Promise<void> } })
        .useSyncStore()
        .reloadAllStores();
      void w;
    });
    await page.waitForTimeout(2500);

    // `reloadAllStores` resets the member filter to the signed-in bean, and the owner
    // owns none of the seeded activities — which is exactly what an empty calendar over
    // a fully-populated doc looks like. Show everyone.
    await page.getByRole('button', { name: 'All Members' }).click();
    await page.waitForTimeout(1200);

    async function shoot(name: string, w = 1440, h = 950) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `screenshots/${name}.png` });
    }

    async function view(label: string) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(1200);
    }

    await shoot('01-month');
    await view('Week');
    await shoot('02-week');
    await view('Day');
    await shoot('03-day');

    // Phone widths — the alignment case, where a variable-width face stack would
    // push titles around most visibly.
    await view('Month');
    await shoot('04-month-phone', 390, 844);
    await view('Day');
    await shoot('05-day-phone', 390, 844);

    // The three tiers side by side at 3x. The blend is real but 13% alpha across a
    // ~90px month chip is easy to miss — this is the shot that answers "is it actually
    // blending?" without needing a colour picker.
    await view('Month');
    await page.evaluate(() => {
      const chips = document.querySelectorAll('[data-testid="month-chip"]');
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;flex-direction:column;gap:24px;padding:48px;font-family:Inter,sans-serif';
      const label = document.createElement('div');
      label.style.cssText = 'font:600 15px Inter;color:#2C3E50';
      label.textContent = 'card tiers at 3x — solo · shared (blend + dashed edge) · celebration';
      host.appendChild(label);
      Array.from(chips)
        .slice(0, 6)
        .forEach((c) => {
          const wrap = document.createElement('div');
          wrap.style.cssText =
            'transform:scale(3);transform-origin:left center;width:300px;margin:20px 0';
          wrap.appendChild(c.cloneNode(true));
          host.appendChild(wrap);
        });
      document.body.appendChild(host);
    });
    await shoot('07-tiers-closeup', 1200, 900);
    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    // Dark mode on the densest surface.
    await page.setViewportSize({ width: 1440, height: 950 });
    await view('Month');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await shoot('06-month-dark');
  });
});
