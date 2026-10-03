import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { TestDataFactory } from '../../e2e/fixtures/data';
import { ui } from '../../e2e/helpers/ui-strings';
import { openAddActivity } from '../../e2e/helpers/activity-modal';
import type { Locator, Page, Route } from '@playwright/test';
import type { FamilyList, MealPlanEntry, Recipe } from '../../src/types/models';
import path from 'node:path';

/**
 * NOT a test: the browser walk for #116, the weekly shopping list from the meal planner
 * (plan docs/plans/2026-09-29-meal-planner-shopping-list.md, mockup
 * docs/mockups/meal-shopping-list-2026-09-29.html). Lives OUTSIDE `e2e/specs/` on
 * purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "meal shopping list walk"
 *
 * Revision 3 (ingredients as written, Cook ×N, duplicates). Seeds a family of five and
 * the acceptance-criteria week (Mon tikka 4 eating, Tue tacos 3 + 2 guests, Wed eat out,
 * Thu stir-fry nobody picked = everyone, Fri tacos 3, Sat bolognese nobody + 3 guests),
 * tikka and the stir-fry sharing "1 cup basmati rice", a one-off "Weekly Groceries" list and
 * a recurring list, then walks: the header button, the week drawer (Cook markers, (×N)
 * suffixes, the exact rice merge, ✨ Find Duplicates with the AI mocked at the BYOK provider
 * boundary, Split, untick, edit, add, Create List, Add to a List), the edit-meal drawer
 * (the Shopping List row below Who's eating with a live Cook ×N pill, the shared RecipeListSheet
 * at this meal's count with (×2) lines, review mode after a create, everyone picked by default,
 * Clear / Everyone, the save mapping), the recipe page sheet, the servings stepper, and the
 * magic beans sheet's hint popover above the sheet.
 * Asserts on exported data; shoots light + dark, phone + desktop.
 *
 * A second test, "meal shopping quick cards", shoots the To-do and Activity drawers' magic
 * beans quick cards (light + dark) under `SHOT_TAG` (before / after the card-button
 * extraction).
 */

const SHOTS = 'screenshots/meal-shopping-list';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}
/** Monday of the current week (the app's default weekStartDay). */
const MON = (() => {
  const d = new Date();
  return addDays(-((d.getDay() + 6) % 7), d);
})();
const DAY = (i: number) => ymd(addDays(i, MON));

const R_TIKKA = '11111111-1111-4111-8111-111111111111';
const R_TACOS = '22222222-2222-4222-8222-222222222222';
const R_STIR = '33333333-3333-4333-8333-333333333333';
const R_MUFFIN = '44444444-4444-4444-8444-444444444444';
const R_BOLO = '55555555-5555-4555-8555-555555555555';

/** `{day}` / `{n}` filled into a UI string, the way `fillTemplate` does. */
const fill = (key: Parameters<typeof ui>[0], vars: Record<string, string>) =>
  Object.entries(vars).reduce((t, [k, v]) => t.replace(`{${k}}`, v), ui(key));
const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

/**
 * The BYOK provider stub for ✨ Find Duplicates: reads the `{ id, text }` lines the app sent
 * and answers with GROUPS of those ids (plus one bogus group the app must drop), never an
 * amount. Everything else gets an empty object.
 */
async function stubDedupeProvider(
  page: Page,
  sent: string[][],
  delayMs: number,
  opts: { empty?: boolean } = {}
) {
  await page.route('https://api.openai.com/v1/chat/completions', async (route: Route) => {
    const body = route.request().postDataJSON() as { messages: { content: unknown }[] };
    const system = String(body.messages[0]?.content ?? '');
    const user = body.messages
      .slice(1)
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : (m.content as { text?: string }[]).map((c) => c.text ?? '').join('\n')
      )
      .join('\n');
    if (!system.includes('You find duplicate items')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
      });
      return;
    }
    const lines = [...user.matchAll(/"id":\s*"(L\d+)",\s*"text":\s*"([^"]*)"/g)].map((m) => ({
      id: m[1]!,
      text: m[2]!,
    }));
    sent.push(lines.map((l) => l.text));
    const idOf = (text: string) => lines.find((l) => l.text === text)?.id ?? 'missing';
    const groups = opts.empty
      ? []
      : [
          {
            name: 'Ground beef',
            lineIds: [idOf('500 g ground beef'), idOf('250 g lean ground beef')],
          },
          { name: 'Bell peppers', lineIds: [idOf('1 bell pepper'), idOf('2 green bell peppers')] },
          {
            name: 'Yellow onion',
            lineIds: [idOf('1 yellow onion, diced'), idOf('1 large yellow onion')],
          },
          { name: 'Bogus', lineIds: ['L999', idOf('1 head broccoli')] },
        ];
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ groups }) } }] }),
    });
  });
}

const consoleErrors: string[] = [];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}
async function shotMatrix(page: Page, name: string, scrollTo?: () => Locator, back = DESKTOP) {
  for (const [vp, vpName] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      if (scrollTo) await scrollTo().scrollIntoViewIfNeeded();
      await shot(page, `${name}-${dark ? 'dark' : 'light'}-${vpName}`);
      if (dark) await contrastProbe(page, `${name}-dark-${vpName}`);
    }
  }
  await setDark(page, false);
  await page.setViewportSize(back);
}

/** Flags visible text whose colour against its composited background is below 4.5:1. */
async function contrastProbe(page: Page, label: string) {
  const bad = await page.evaluate(() => {
    const parse = (c: string): number[] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const bgOf = (el: Element | null): number[] => {
      const stack: number[][] = [];
      let n: Element | null = el;
      while (n) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return [-1, -1, -1];
        const c = parse(cs.backgroundColor);
        if (c && c[3]! > 0) {
          stack.push(c);
          if (c[3]! >= 1) break;
        }
        n = n.parentElement;
      }
      let out = [255, 255, 255];
      if (!stack.length || stack[stack.length - 1]![3]! < 1)
        out = document.documentElement.classList.contains('dark') ? [20, 26, 34] : [255, 255, 255];
      for (let i = stack.length - 1; i >= 0; i--) {
        const [r, g, b, a] = stack[i]!;
        out = [
          r! * a! + out[0]! * (1 - a!),
          g! * a! + out[1]! * (1 - a!),
          b! * a! + out[2]! * (1 - a!),
        ];
      }
      return out;
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const roots = dialogs.length ? dialogs : [document.body];
    const res: string[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      while (walker.nextNode()) {
        const tn = walker.currentNode as Text;
        const el = tn.parentElement;
        if (!el || seen.has(el) || !tn.textContent?.trim()) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.closest('.sr-only')) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = bgOf(el);
        if (bg[0] === -1) continue;
        const a = fg[3]!;
        const f = [
          fg[0]! * a + bg[0]! * (1 - a),
          fg[1]! * a + bg[1]! * (1 - a),
          fg[2]! * a + bg[2]! * (1 - a),
        ];
        const l1 = lum(f),
          l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const disabled = !!el.closest('button:disabled');
        if (ratio < 4.5 && !disabled)
          res.push(
            `${ratio.toFixed(2)} "${tn.textContent.trim().slice(0, 40)}" fg=${cs.color} bg=rgb(${bg.map(Math.round).join(',')})`
          );
      }
    }
    return res.slice(0, 25);
  });
  if (bad.length) console.log(`[contrast] ${label}:\n  ${bad.join('\n  ')}`);
}

async function overflowProbe(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const over: string[] = [];
    for (const d of document.querySelectorAll('[role="dialog"] *')) {
      const el = d as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.right > innerWidth + 1 &&
        getComputedStyle(el).position !== 'fixed'
      )
        over.push(
          `${el.tagName}.${String(el.className).slice(0, 50)} right=${Math.round(rect.right)}`
        );
    }
    return {
      pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      over: over.slice(0, 8),
    };
  });
  console.log(`[overflow] ${label}: ${JSON.stringify(r)}`);
}

const lists = async (db: IndexedDBHelper) =>
  ((await db.exportData()) as unknown as { lists?: FamilyList[] }).lists ?? [];
const recipes = async (db: IndexedDBHelper) => (await db.exportData()).recipes ?? [];
const meals = async (db: IndexedDBHelper) =>
  ((await db.exportData()) as unknown as { mealPlans?: MealPlanEntry[] }).mealPlans ?? [];

test('meal shopping list walk', async ({ page }) => {
  test.setTimeout(600_000);
  page.on('pageerror', (e) => {
    consoleErrors.push(`[pageerror] ${e.message}`);
    console.log(`[pageerror] ${e.message}`);
  });
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() === 'error' || m.type() === 'warning') {
      if (m.type() === 'error') consoleErrors.push(`[console.error] ${txt.slice(0, 300)}`);
      if (m.type() === 'error' || /shopping|ingredient|servings/i.test(txt))
        console.log(`[console.${m.type()}] ${txt.slice(0, 300)}`);
    }
  });

  // The approved mockup, for side-by-side comparison.
  const mock = await page.context().newPage();
  const mockUrl = 'file://' + path.resolve('docs/mockups/meal-shopping-list-2026-09-29.html');
  await mock.setViewportSize(DESKTOP);
  await mock.goto(mockUrl);
  await mock.screenshot({ path: `${SHOTS}/00-mockup-desktop.png`, fullPage: true });
  await mock.close();

  await page.setViewportSize(DESKTOP);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers[0]!;
  const now = new Date().toISOString();

  const mk = (name: string, color: string, ageGroup: string) =>
    TestDataFactory.createFamilyMember({
      id: `m-${name.toLowerCase()}`,
      name,
      email: `${name.toLowerCase()}@test.com`,
      role: 'member',
      color,
      ...({ ageGroup, gender: 'male' } as object),
    });
  const sofia = mk('Sofia', '#E67E22', 'adult');
  const leo = mk('Leo', '#F15D22', 'child');
  const milo = mk('Milo', '#3D8FD1', 'child');
  const theo = mk('Theo', '#27AE60', 'child');

  const recipe = (id: string, name: string, servings: string | undefined, ingredients: string[]) =>
    ({
      id,
      name,
      servings,
      ingredients,
      steps: ['Cook it.'],
      createdAt: now,
      updatedAt: now,
    }) as Recipe;

  const meal = (
    id: string,
    date: string,
    kind: MealPlanEntry['kind'],
    recipeId?: string,
    eaterMemberIds?: string[],
    guestNames?: string[]
  ): MealPlanEntry => ({
    id,
    date,
    slot: 'dinner',
    position: 0,
    kind,
    recipeId,
    eaterMemberIds,
    guestNames,
    cooked: false,
    createdAt: now,
    updatedAt: now,
  });

  const list = (over: Partial<FamilyList>): FamilyList =>
    ({
      emoji: '🛒',
      category: 'out',
      ownerId: owner.id,
      completed: false,
      createdBy: owner.id,
      createdAt: now,
      updatedAt: now,
      ...over,
    }) as FamilyList;

  await db.seedData({
    familyMembers: [sofia, leo, milo, theo],
    recipes: [
      recipe(R_TIKKA, 'Chicken Tikka Masala', '4', [
        '600 g chicken thighs',
        '1 cup plain yogurt',
        '1 yellow onion, diced',
        '1 cup basmati rice',
        'Fresh coriander, to serve',
      ]),
      recipe(R_TACOS, 'Beef Tacos', 'Serves 4', [
        '500 g ground beef',
        '8 taco shells',
        '1/2 cup sour cream',
        '1 bell pepper',
        'Salt, to taste',
        'For the salsa:',
        '2 tomatoes',
      ]),
      recipe(R_STIR, 'Veggie Stir-Fry', '4', [
        '2 green bell peppers',
        '1 head broccoli',
        '3 tbsp soy sauce',
        '1 cup basmati rice',
      ]),
      recipe(R_BOLO, 'Spaghetti Bolognese', '4', [
        '400 g spaghetti',
        '250 g lean ground beef',
        '1 large yellow onion',
      ]),
      recipe(R_MUFFIN, 'Blueberry Muffins', '12 muffins', ['2 cups flour', '1 cup blueberries']),
    ],
    ...({
      mealPlans: [
        meal('mp-mon', DAY(0), 'recipe', R_TIKKA, [owner.id, sofia.id, leo.id, milo.id]),
        meal('mp-tue', DAY(1), 'recipe', R_TACOS, [owner.id, sofia.id, leo.id], ['Ann', 'Bob']),
        meal('mp-wed', DAY(2), 'eat_out'),
        meal('mp-thu', DAY(3), 'recipe', R_STIR),
        meal('mp-fri', DAY(4), 'recipe', R_TACOS, [owner.id, sofia.id, leo.id]),
        meal('mp-sat', DAY(5), 'recipe', R_BOLO, undefined, ['Ann', 'Bob', 'Cy']),
      ],
      lists: [
        list({
          id: 'l-weekly',
          title: 'Weekly Groceries',
          lifecycle: 'oneoff',
          items: [
            { id: 'wg1', title: 'Milk', completed: false },
            { id: 'wg2', title: 'Bread', completed: false },
          ],
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        }),
        list({
          id: 'l-pantry',
          title: 'Pantry Staples',
          emoji: '🥫',
          lifecycle: 'recurring',
          frequency: 'weekly',
          items: [{ id: 'ps1', title: 'Rice', completed: false }],
        }),
      ],
    } as object),
  });

  // ── 1. Header button + badge ─────────────────────────────────────────────────
  await gotoRoute(page, '/meal-planner');
  const btn = page.getByTestId('meal-shopping-button');
  await btn.waitFor({ timeout: 20000 });
  await expect(btn).toBeEnabled();
  const badgeText = (await btn.locator('span[role="img"]').textContent())?.trim();
  console.log(
    '[1] badge:',
    badgeText,
    'aria:',
    await btn.locator('span[role="img"]').getAttribute('aria-label')
  );
  expect(badgeText).toBe('4');
  await shotMatrix(page, '01-header-button');

  // Phone: the day nav moves a day at a time, and the shopping week follows the day ON
  // SCREEN: +7 days lands in next week, which has no meals, so the button is disabled.
  await page.setViewportSize(PHONE);
  for (let i = 0; i < 7; i++)
    await page
      .getByRole('button', { name: ui('common.next') })
      .filter({ visible: true })
      .click();
  await page.waitForTimeout(300);
  console.log(
    '[1-phone] after +7 days, badge =',
    // No badge in an empty week; `textContent()` on a missing node would wait forever.
    (await btn.locator('span[role="img"]').count())
      ? await btn.locator('span[role="img"]').textContent()
      : 'none',
    'enabled =',
    await btn.isEnabled()
  );
  await expect(btn).toBeDisabled();
  await shot(page, '01b-phone-next-week-day-light-phone');
  for (let i = 0; i < 7; i++)
    await page
      .getByRole('button', { name: ui('common.previous') })
      .filter({ visible: true })
      .click();
  await expect(btn).toBeEnabled();

  // Far week: disabled + hint
  await page.setViewportSize(DESKTOP);
  for (let i = 0; i < 8; i++)
    await page
      .getByRole('button', { name: ui('common.next') })
      .filter({ visible: true })
      .click();
  await expect(btn).toBeDisabled();
  await expect(page.locator('#mp-shopping-hint')).toBeVisible();
  console.log('[1] far week hint:', await page.locator('#mp-shopping-hint').textContent());
  await shotMatrix(page, '01c-header-disabled');
  await page.getByRole('button', { name: ui('mealPlanner.thisWeek'), exact: true }).click();
  await expect(btn).toBeEnabled();

  // ── 2. Week drawer ───────────────────────────────────────────────────────────
  const weekDrawer = () =>
    page.getByRole('dialog').filter({ has: page.getByTestId('week-shopping-subtitle') });
  const sections = weekDrawer().getByTestId('week-shopping-section');
  const merged = () => weekDrawer().getByTestId('week-shopping-merged');
  const findCard = () => weekDrawer().getByTestId('find-duplicates');
  const valuesIn = (loc: Locator) =>
    loc
      .getByTestId('ingredient-text')
      .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  const readSections = () =>
    sections.evaluateAll((els) =>
      els.map((el) => ({
        name: el.querySelector('h3')?.textContent?.trim(),
        cook: el
          .querySelector('[data-testid="cook-count-pill"] [aria-hidden="true"]')
          ?.textContent?.trim(),
        meals: [...el.querySelectorAll('[data-testid="meal-pill"]')].map((s) =>
          s.textContent?.trim()
        ),
        allMerged: !!el.querySelector('[data-testid="ingredients-all-merged"]'),
        lines: [...el.querySelectorAll('[data-testid="ingredient-text"]')].map(
          (t) => (t as HTMLTextAreaElement).value
        ),
      }))
    );

  await btn.click();
  await weekDrawer().waitFor({ timeout: 8000 });
  await expect(sections).toHaveCount(4);
  console.log(
    '[2] subtitle:',
    await weekDrawer().getByTestId('week-shopping-subtitle').textContent()
  );
  const info = await readSections();
  console.log('[2] sections:', JSON.stringify(info, null, 1));
  const [tikkaS, tacosS, stirS, boloS] = info;
  expect(tikkaS).toMatchObject({
    name: 'Chicken Tikka Masala',
    cook: ui('mealPlanner.shopping.cook.once'),
  });
  // As written, no suffix, and the shared rice line is not here (it is in the merged section).
  expect(tikkaS!.lines).toEqual([
    '600 g chicken thighs',
    '1 cup plain yogurt',
    '1 yellow onion, diced',
    'Fresh coriander, to serve',
  ]);
  expect(tacosS!.cook).toBe(fill('mealPlanner.shopping.cook.times', { n: '3' }));
  expect(tacosS!.meals).toEqual([
    fill('mealPlanner.shopping.eatingPill', { day: weekday(DAY(1)), n: '5' }),
    fill('mealPlanner.shopping.eatingPill', { day: weekday(DAY(4)), n: '3' }),
  ]);
  expect(tacosS!.lines).toEqual([
    '500 g ground beef (×3)',
    '8 taco shells (×3)',
    '1/2 cup sour cream (×3)',
    '1 bell pepper (×3)',
    'Salt, to taste (×3)',
    '2 tomatoes (×3)',
  ]);
  expect(stirS!.cook).toBe(fill('mealPlanner.shopping.cook.times', { n: '2' }));
  expect(stirS!.meals).toEqual([
    fill('mealPlanner.shopping.everyonePill', { day: weekday(DAY(3)), n: '5' }),
  ]);
  expect(boloS!.meals).toEqual([
    fill('mealPlanner.shopping.everyonePill', { day: weekday(DAY(5)), n: '8' }),
  ]);
  expect(boloS!.cook).toBe(fill('mealPlanner.shopping.cook.times', { n: '2' }));
  // The exact merge: 1 cup basmati rice ×1 (tikka) + ×2 (stir-fry) → (×3), with both recipes.
  expect(await valuesIn(merged())).toEqual(['1 cup basmati rice (×3)']);
  expect(await merged().getByTestId('merged-source-pill').allTextContents()).toEqual([
    'Chicken Tikka Masala',
    'Veggie Stir-Fry',
  ]);
  // Managed tier (the default): the card shows, with "Free".
  await expect(findCard()).toBeVisible();
  await expect(weekDrawer().getByTestId('find-duplicates-free')).toBeVisible();
  await overflowProbe(page, '2 drawer desktop');
  await shotMatrix(page, '02a-week-drawer-before-find');
  await page.setViewportSize(PHONE);
  await overflowProbe(page, '2 drawer phone');
  await page.setViewportSize(DESKTOP);
  await page.keyboard.press('Escape');
  await expect(weekDrawer()).toHaveCount(0, { timeout: 5000 });

  // BYOK (OpenAI) so the AI call can be stubbed at the provider boundary. The managed tier is
  // sealed end to end and cannot be faked from here. "Free" is managed-only, so it goes.
  const exported = await db.exportData();
  await db.seedData({
    settings: {
      ...(exported.settings as object),
      aiTier: 'byok',
      aiProvider: 'openai',
      aiApiKeys: { openai: 'sk-test-meal-dupes' },
    } as never,
  });
  const sent: string[][] = [];
  await stubDedupeProvider(page, sent, 1500);
  await gotoRoute(page, '/meal-planner');
  await btn.waitFor({ timeout: 20000 });
  await page.setViewportSize(PHONE);
  await btn.click();
  await weekDrawer().waitFor({ timeout: 8000 });
  await expect(findCard()).toBeVisible();
  await expect(weekDrawer().getByTestId('find-duplicates-free')).toHaveCount(0);
  await findCard().click();
  // First read asks for consent (the ingredients variant).
  const consent = page.getByRole('dialog').filter({ hasText: ui('ai.consent.title') });
  const confirmBtn = consent.getByRole('button', { name: ui('ai.consent.ingredients.confirm') });
  await confirmBtn.waitFor({ timeout: 6000 });
  // Its own copy: a list tidy, not "read this photo, document or selected text".
  await expect(consent.getByText(ui('ai.consent.ingredients.afterValue'))).toBeVisible();
  await expect(consent).not.toContainText(ui('ai.consent.afterValue'));
  // Its own "don't ask again" (a list is not a document the family chose).
  await expect(consent.getByText(ui('ai.consent.ingredients.remember'))).toBeVisible();
  await expect(consent).not.toContainText(ui('ai.consent.remember'));
  await shot(page, '02b-find-consent-light-phone');
  await setDark(page, true);
  await shot(page, '02b-find-consent-dark-phone');
  await contrastProbe(page, '02b-find-consent-dark-phone');
  await setDark(page, false);
  await confirmBtn.click();
  // Running: busy sheen, "Finding duplicates…", cannot be tapped twice.
  await expect(findCard()).toHaveAttribute('aria-busy', 'true', { timeout: 4000 });
  await expect(findCard()).toContainText(ui('mealPlanner.shopping.dupes.running'));
  await expect(findCard()).toHaveClass(/magic-shimmer-busy/);
  await expect(weekDrawer().getByTestId('find-duplicates-running')).toHaveClass(
    /magic-text-shimmer/
  );
  await expect(weekDrawer().getByTestId('find-duplicates-sparkle')).toBeAttached();
  // Proof the label actually sweeps: the gradient is painted through the text.
  console.log(
    '[2] running label paint:',
    await weekDrawer()
      .getByTestId('find-duplicates-running')
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { clip: cs.backgroundClip, color: cs.color, anim: cs.animationName };
      })
  );
  await shot(page, '02c-find-running-light-phone');
  await findCard()
    .click({ force: true })
    .catch(() => {});
  await weekDrawer().getByTestId('dupes-found').waitFor({ timeout: 15000 });
  console.log('[2] lines sent to magic beans:', JSON.stringify(sent));
  expect(sent).toHaveLength(1);
  expect(sent[0]!.some((t) => /×|basmati/.test(t))).toBe(false);
  const mergedAfter = await valuesIn(merged());
  console.log('[2] merged after find:', JSON.stringify(mergedAfter));
  expect(mergedAfter).toEqual([
    '1 cup basmati rice (×3)',
    'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)',
    'Bell peppers: 1 bell pepper (×3) + 2 green bell peppers (×2)',
    'Yellow onion: 1 yellow onion, diced + 1 large yellow onion (×2)',
  ]);
  await expect(findCard()).toHaveCount(0);
  await expect(weekDrawer().getByTestId('dupes-found')).toContainText(
    fill('mealPlanner.shopping.dupes.found.other', { n: '3' })
  );
  // Focus moves to the header, which carries "✨ 3 found": the live region stays quiet so the
  // result is read once, not twice.
  await expect(weekDrawer().getByTestId('dupes-announce')).toHaveText('');
  await expect(weekDrawer().getByTestId('week-shopping-merged-title')).toContainText(
    fill('mealPlanner.shopping.dupes.found.other', { n: '3' })
  );
  expect(await merged().getByTestId('merged-by-magic').count()).toBe(3);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')).toBe(
    'week-shopping-merged-title'
  );
  console.log('[2] sections after find:', JSON.stringify(await readSections(), null, 1));
  await page.setViewportSize(DESKTOP);
  await shotMatrix(page, '02d-week-drawer-after-find');

  // Split "Yellow onion": both lines go back to their recipes.
  const mergedLine = async (prefix: string) => {
    const all = merged().getByTestId('ingredient-line');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const v = await all.nth(i).getByTestId('ingredient-text').inputValue();
      if (v.startsWith(prefix)) return all.nth(i);
    }
    throw new Error(`no merged line "${prefix}"`);
  };
  const onion = await mergedLine('Yellow onion:');
  console.log(
    '[2] split aria:',
    await onion.getByTestId('merged-split').getAttribute('aria-label')
  );
  const undoBtn = () =>
    page.getByRole('button', { name: ui('action.undo'), exact: true }).filter({ visible: true });
  await onion.getByTestId('merged-split').click();
  const assertSplit = async () => {
    const afterSplit = await readSections();
    expect(afterSplit[0]!.lines).toContain('1 yellow onion, diced');
    expect(afterSplit[3]!.lines).toContain('1 large yellow onion (×2)');
    expect((await valuesIn(merged())).some((v) => v.startsWith('Yellow onion'))).toBe(false);
  };
  await assertSplit();
  // The house toast offers Undo, which puts the merged line back exactly where it was.
  await expect(
    page.getByText(fill('mealPlanner.shopping.dupes.splitDone', { n: '2' }))
  ).toBeVisible();
  await page.setViewportSize(PHONE);
  await shot(page, '02e0-split-undo-toast-light-phone');
  await page.setViewportSize(DESKTOP);
  await undoBtn().first().click();
  await expect.poll(() => valuesIn(merged()), { timeout: 4000 }).toEqual(mergedAfter);
  console.log('[2] undo split restored:', JSON.stringify(await valuesIn(merged())));
  // Split again for the rest of the walk.
  await (await mergedLine('Yellow onion:')).getByTestId('merged-split').click();
  await assertSplit();
  await shotMatrix(page, '02e-week-drawer-after-split', () => sections.nth(0));

  // Untick "Salt, to taste (×3)"; edit taco shells; add a line to tikka; tick/untick all on stir-fry.
  const lineByValue = async (sec: Locator, value: string) => {
    const all = sec.getByTestId('ingredient-line');
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      if ((await all.nth(i).getByTestId('ingredient-text').inputValue()) === value)
        return all.nth(i);
    }
    throw new Error(`no line "${value}"`);
  };
  const salt = await lineByValue(sections.nth(1), 'Salt, to taste (×3)');
  await salt.getByRole('button').first().click();
  expect(await salt.getByRole('button').first().getAttribute('aria-pressed')).toBe('false');
  const shells = await lineByValue(sections.nth(1), '8 taco shells (×3)');
  await shells.getByTestId('ingredient-text').fill('8 corn tortillas (×3)');
  // Enter on an existing line finishes the edit: the field lets go and the text stays.
  await shells.getByTestId('ingredient-text').press('Enter');
  expect(
    await shells.getByTestId('ingredient-text').evaluate((el) => el === document.activeElement)
  ).toBe(false);
  expect(await shells.getByTestId('ingredient-text').inputValue()).toBe('8 corn tortillas (×3)');
  const addTikka = sections.nth(0).getByTestId('ingredient-add');
  await addTikka.fill('Limes');
  await addTikka.press('Enter');
  const stirToggle = sections.nth(2).getByTestId('ingredients-toggle-all');
  console.log('[2] stir toggle label before:', await stirToggle.textContent());
  await stirToggle.click();
  console.log('[2] stir toggle label after untick all:', await stirToggle.textContent());
  await stirToggle.click();
  // Focus visibility on an ingredient line.
  await page.setViewportSize(PHONE);
  await setDark(page, true);
  await (
    await lineByValue(sections.nth(1), '1/2 cup sour cream (×3)')
  )
    .getByTestId('ingredient-text')
    .focus();
  await shot(page, '02f-week-drawer-focus-dark-phone');
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);

  // Destination: New List with a name.
  await weekDrawer()
    .getByTestId('destination-name')
    .locator('input')
    .or(weekDrawer().getByTestId('destination-name'))
    .first()
    .fill('Week Shop Test');
  const listsBefore = await lists(db);
  const save2 = weekDrawer().getByRole('button', { name: /Create List/ });
  console.log('[2] save label:', await save2.textContent());
  await save2.click();
  await expect
    .poll(async () => (await lists(db)).length, { timeout: 8000 })
    .toBe(listsBefore.length + 1);
  const weekList = (await lists(db)).find((l) => l.title === 'Week Shop Test')!;
  const wlTitles = weekList.items.map((i) => i.title);
  console.log(
    '[2] created list:',
    JSON.stringify({
      cat: weekList.category,
      lc: weekList.lifecycle,
      link: weekList.linkedRecipeId,
      items: wlTitles,
    })
  );
  expect(weekList.category).toBe('out');
  expect(weekList.lifecycle).toBe('oneoff');
  expect(weekList.linkedRecipeId).toBeUndefined();
  expect(wlTitles).toContain('1 cup basmati rice (×3)');
  expect(wlTitles).toContain('Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)');
  expect(wlTitles).toContain('8 corn tortillas (×3)');
  expect(wlTitles).toContain('Limes');
  expect(wlTitles).toContain('1 yellow onion, diced');
  expect(wlTitles).toContain('1 large yellow onion (×2)');
  // Merged parts are written once, as the merged line; unticked and headings never.
  expect(wlTitles).not.toContain('500 g ground beef (×3)');
  expect(wlTitles).not.toContain('1 cup basmati rice');
  expect(wlTitles).not.toContain('Salt, to taste (×3)');
  expect(wlTitles).not.toContain('8 taco shells (×3)');
  expect(wlTitles).not.toContain('For the salsa:');
  await expect(weekDrawer()).toHaveCount(0, { timeout: 5000 });
  await shot(page, '02g-after-create-toast-light-desktop');

  // The Lists page: long items WRAP in full (never an ellipsis), on a phone, light + dark.
  await page
    .getByRole('button', { name: ui('lists.fromRecipe.view') })
    .filter({ visible: true })
    .first()
    .click();
  const listDialog = page.getByRole('dialog').filter({ hasText: 'Week Shop Test' });
  await listDialog.waitFor({ timeout: 8000 });
  await page.setViewportSize(PHONE);
  const longItem = listDialog.getByText(
    'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)',
    { exact: true }
  );
  await longItem.scrollIntoViewIfNeeded();
  const wrap = await longItem.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      overflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      clipped: el.scrollWidth > el.clientWidth + 1,
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight || '20')),
    };
  });
  console.log('[2] list item wrap:', JSON.stringify(wrap));
  expect(wrap.clipped).toBe(false);
  expect(wrap.overflow).not.toBe('ellipsis');
  expect(wrap.lines).toBeGreaterThan(1);
  for (const dark of [false, true]) {
    await setDark(page, dark);
    await longItem.scrollIntoViewIfNeeded();
    await shot(page, `02g1-list-detail-long-items-${dark ? 'dark' : 'light'}-phone`);
  }
  await setDark(page, false);
  // Inline edit on a wrapped row: the edit field wraps too, holding the whole item.
  await longItem.click();
  const editInput = listDialog.getByRole('textbox', { name: ui('lists.detail.editItem') });
  await expect(editInput).toBeVisible();
  const editWrap = await editInput.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    const cs = getComputedStyle(ta);
    return {
      tag: ta.tagName,
      value: ta.value,
      clipped: ta.scrollWidth > ta.clientWidth + 1 || ta.scrollHeight > ta.clientHeight + 1,
      lines: Math.round(ta.getBoundingClientRect().height / parseFloat(cs.lineHeight || '24')),
    };
  });
  console.log('[2] list item edit wrap:', JSON.stringify(editWrap));
  expect(editWrap.tag).toBe('TEXTAREA');
  expect(editWrap.value).toBe('Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)');
  expect(editWrap.clipped).toBe(false);
  expect(editWrap.lines).toBeGreaterThan(1);
  for (const dark of [false, true]) {
    await setDark(page, dark);
    await shot(page, `02g2-list-item-edit-long-${dark ? 'dark' : 'light'}-phone`);
  }
  await setDark(page, false);
  // One line at the SOURCE: a paste mid-text lands at the caret as one line, caret after it.
  const LONG = 'Ground beef: 500 g ground beef (×3) + 250 g lean ground beef (×2)';
  const PASTED = 'Ground beef: extra lean 500 g ground beef (×3) + 250 g lean ground beef (×2)';
  const pasted = await editInput.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(12, 12); // after "Ground beef:"
    const dt = new DataTransfer();
    dt.setData('text/plain', ' extra\nlean');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return { value: ta.value, caret: ta.selectionStart, prevented: ev.defaultPrevented };
  });
  console.log('[2] list item paste:', JSON.stringify(pasted));
  expect(pasted).toEqual({ value: PASTED, caret: 12 + ' extra lean'.length, prevented: true });
  await shot(page, '02g3-list-item-paste-light-phone');
  // A phone keyboard's Return with no Enter keydown (Android) commits, exactly like Enter.
  const returnBlocked = await editInput.evaluate((el) => {
    const ev = new InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(returnBlocked).toBe(true);
  await expect(editInput).toHaveCount(0);
  const pastedItem = listDialog.getByText(PASTED, { exact: true });
  await expect(pastedItem).toBeVisible();
  expect(await pastedItem.evaluate((el) => el.textContent)).not.toContain('\n');
  // Desktop: a hardware Enter commits too (restoring the item for the rest of the walk).
  await page.setViewportSize(DESKTOP);
  await pastedItem.click();
  await editInput.fill(LONG);
  await editInput.press('Enter');
  await expect(editInput).toHaveCount(0);
  await expect(longItem).toBeVisible();
  await page.setViewportSize(PHONE);
  await page.keyboard.press('Escape');
  await page.setViewportSize(DESKTOP);
  await page.keyboard.press('Escape');
  await gotoRoute(page, '/meal-planner');
  await btn.waitFor({ timeout: 20000 });

  // Reopen: a fresh open (the card is back), Add to a List -> Weekly Groceries, recurring not offered.
  await btn.click();
  await weekDrawer().waitFor({ timeout: 8000 });
  await expect(findCard()).toBeVisible();
  expect(await valuesIn(merged())).toEqual(['1 cup basmati rice (×3)']);

  // ✨ An empty run, driven from the KEYBOARD so :focus-visible carries to where focus lands.
  // The ingredients prompt asks again (only its own "don't ask again" skips it): tick it now.
  await page.unroute('https://api.openai.com/v1/chat/completions');
  await stubDedupeProvider(page, sent, 300, { empty: true });
  await page.setViewportSize(PHONE);
  await findCard().focus();
  await page.keyboard.press('Enter');
  const consentAgain = page.getByRole('dialog').filter({ hasText: ui('ai.consent.title') });
  const confirmAgain = consentAgain.getByRole('button', {
    name: ui('ai.consent.ingredients.confirm'),
  });
  await confirmAgain.waitFor({ timeout: 6000 });
  await consentAgain.getByText(ui('ai.consent.ingredients.remember')).click();
  await shot(page, '02b2-find-consent-remember-ticked-light-phone');
  await confirmAgain.focus();
  await page.keyboard.press('Enter');
  const noneTile = weekDrawer().getByTestId('dupes-none');
  await noneTile.waitFor({ timeout: 10000 });
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''))
    .toBe('dupes-none');
  // Focus reads the tile, so the live region does not repeat it.
  await expect(weekDrawer().getByTestId('dupes-announce')).toHaveText('');
  for (const dark of [false, true]) {
    await setDark(page, dark);
    const ring = await noneTile.evaluate((el) => ({
      focusVisible: el.matches(':focus-visible'),
      boxShadow: getComputedStyle(el).boxShadow,
    }));
    console.log(`[2] none tile focus ring (${dark ? 'dark' : 'light'}):`, JSON.stringify(ring));
    expect(ring.focusVisible).toBe(true);
    expect(ring.boxShadow).not.toBe('none');
    await shot(page, `02h0-find-none-focus-${dark ? 'dark' : 'light'}-phone`);
  }
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);
  await weekDrawer().getByTestId('destination-existing').click();
  const rows = weekDrawer().getByTestId('list-choice-row');
  const rowTexts = await rows.allTextContents();
  console.log(
    '[2] Add to a List rows:',
    JSON.stringify(rowTexts.map((t) => t.replace(/\s+/g, ' ').trim()))
  );
  expect(rowTexts.some((t) => t.includes('Weekly Groceries'))).toBe(true);
  expect(rowTexts.some((t) => t.includes('Pantry Staples'))).toBe(false);
  await rows.filter({ hasText: 'Weekly Groceries' }).click();
  await shotMatrix(page, '02h-week-drawer-add-to-list', () => rows.first());
  const addBtn = weekDrawer().getByRole('button', { name: /^Add \d+ Items?$/ });
  const addLabel = await addBtn.textContent();
  console.log('[2] add label:', addLabel);
  const n = Number(addLabel!.match(/\d+/)![0]);
  const listCount = (await lists(db)).length;
  await addBtn.click();
  await expect
    .poll(async () => (await lists(db)).find((l) => l.id === 'l-weekly')!.items.length, {
      timeout: 8000,
    })
    .toBe(2 + n);
  expect((await lists(db)).length).toBe(listCount);

  // ── 3. Edit-meal drawer: Tuesday's tacos ─────────────────────────────────────
  // Since the 2026-10-02 change the drawer no longer hosts an ingredients panel: a
  // "Shopping List" row below Who's eating carries a live Cook ×N pill and opens the
  // cookbook's RecipeListSheet (same view as the recipe page) at this meal's count.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  const openMeal = async (recipeName: string) => {
    await page
      .locator('[role="button"][draggable="true"]')
      .filter({ visible: true })
      .filter({ hasText: recipeName })
      .first()
      .click();
    await mealDrawer().waitFor({ timeout: 8000 });
  };
  const mealDrawer = () =>
    page.getByRole('dialog').filter({ has: page.getByTestId('meal-shopping-open') });
  const openShopping = () => mealDrawer().getByTestId('meal-shopping-open');
  const cookText = async () =>
    (
      await openShopping()
        .getByTestId('cook-count-pill')
        .locator('[aria-hidden="true"]')
        .textContent()
    )?.trim();
  const mealSheet = () =>
    page
      .getByRole('dialog')
      .filter({ hasText: ui('lists.fromRecipe.title') })
      .filter({ hasNot: page.getByTestId('meal-shopping-open') });
  const sheetValues = () =>
    mealSheet()
      .getByTestId('ingredient-text')
      .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  const allToggle = () => mealDrawer().getByTestId('family-chip-all-toggle');
  await openMeal('Beef Tacos');
  // The drawer: no checklist inline; the row sits below Who's eating with Cook ×2 (3 + 2 guests, serves 4).
  expect(await mealDrawer().getByTestId('ingredient-text').count()).toBe(0);
  expect(await cookText()).toBe(fill('mealPlanner.shopping.cook.times', { n: '2' }));
  const eatersBox = await mealDrawer().getByTestId('family-chip-all-toggle').boundingBox();
  const rowBox = await openShopping().boundingBox();
  console.log('[3] eaters toggle y:', eatersBox?.y, '| shopping row y:', rowBox?.y);
  expect(rowBox!.y, 'the Shopping List row sits below Who is eating').toBeGreaterThan(eatersBox!.y);
  // Tuesday has a stored subset (3 of 5): the toggle offers Everyone.
  expect((await allToggle().textContent())?.trim()).toBe(ui('common.everyone'));
  await openShopping().scrollIntoViewIfNeeded();
  await shotMatrix(page, '03a-meal-drawer-row', () => openShopping());
  // Open the sheet at ×2: the recipe page's view with this meal's count and suffixes.
  await openShopping().click();
  await mealSheet().waitFor({ timeout: 8000 });
  const sheetCook = (
    await mealSheet().getByTestId('cook-count-pill').locator('[aria-hidden="true"]').textContent()
  )?.trim();
  console.log('[3] sheet cook:', sheetCook, '| lines:', JSON.stringify(await sheetValues()));
  expect(sheetCook).toBe(fill('mealPlanner.shopping.cook.times', { n: '2' }));
  expect(await sheetValues()).toEqual([
    '500 g ground beef (×2)',
    '8 taco shells (×2)',
    '1/2 cup sour cream (×2)',
    '1 bell pepper (×2)',
    'Salt, to taste (×2)',
    '2 tomatoes (×2)',
  ]);
  await shotMatrix(page, '03b-meal-sheet-x2');
  await page.keyboard.press('Escape');
  await expect(mealSheet()).toHaveCount(0, { timeout: 5000 });
  await expect(mealDrawer()).toHaveCount(1);
  // Remove one member (Leo): 2 members + 2 guests = 4 -> the pill reads Cook Once, live.
  const leoChip = mealDrawer().getByRole('button', { name: 'Leo' });
  await leoChip.last().click();
  await expect.poll(cookText, { timeout: 4000 }).toBe(ui('mealPlanner.shopping.cook.once'));
  // Reopen: the sheet is built at the NEW count (no suffix). Edit a line, name a New List, create.
  await openShopping().click();
  await mealSheet().waitFor({ timeout: 8000 });
  const vals3 = await sheetValues();
  console.log('[3] after eater change:', JSON.stringify(vals3));
  expect(vals3).toContain('500 g ground beef');
  expect(vals3).not.toContain('500 g ground beef (×2)');
  const shells3 = await lineByValue(mealSheet(), '8 taco shells');
  await shells3.getByTestId('ingredient-text').fill('16 corn tortillas');
  await mealSheet().getByTestId('destination-new').click();
  await mealSheet()
    .getByTestId('destination-name')
    .locator('input')
    .or(mealSheet().getByTestId('destination-name'))
    .first()
    .fill('Tuesday Tacos');
  await shotMatrix(page, '03c-meal-sheet-once-edited');
  const create3 = mealSheet().getByRole('button', {
    name: ui('lists.destination.createList'),
    exact: true,
  });
  const c3 = (await lists(db)).length;
  await create3.click();
  await expect.poll(async () => (await lists(db)).length, { timeout: 8000 }).toBe(c3 + 1);
  await expect(mealSheet()).toHaveCount(0, { timeout: 5000 });
  const tl = (await lists(db)).find((l) => l.title === 'Tuesday Tacos')!;
  console.log(
    '[3] meal list:',
    JSON.stringify({ link: tl.linkedRecipeId, items: tl.items.map((i) => i.title) })
  );
  expect(tl.linkedRecipeId).toBe(R_TACOS);
  expect(tl.items.map((i) => i.title)).toContain('16 corn tortillas');
  // Reopen: review mode shows the list just made, so a second tap makes no second list.
  await openShopping().click();
  await mealSheet().waitFor({ timeout: 8000 });
  await expect(mealSheet().getByTestId('recipe-list-start-another')).toBeVisible();
  await expect(mealSheet().getByText('Tuesday Tacos')).toBeVisible();
  await shotMatrix(page, '03d-meal-sheet-review');
  await page.keyboard.press('Escape');
  await expect(mealSheet()).toHaveCount(0, { timeout: 5000 });
  expect((await lists(db)).length, 'review mode made no second list').toBe(c3 + 1);
  // Cancel the meal edit: list stays, meal eaters unchanged.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const discard = page.getByRole('button', { name: /discard|leave/i });
  if (await discard.count()) {
    console.log('[3] unsaved-changes prompt appeared');
    await discard.first().click();
  }
  await expect(mealDrawer()).toHaveCount(0, { timeout: 5000 });
  const tue = (await meals(db)).find((m) => m.id === 'mp-tue')!;
  console.log(
    '[3] tue meal after cancel:',
    JSON.stringify({ eaters: tue.eaterMemberIds, guests: tue.guestNames })
  );
  expect(tue.eaterMemberIds).toHaveLength(3);
  expect((await lists(db)).some((l) => l.id === tl.id)).toBe(true);

  // Thursday (nobody stored): everyone picked, the toggle reads Clear, Cook ×2 for 5.
  const saveMeal = () =>
    mealDrawer().getByRole('button', { name: ui('mealPlanner.editor.save'), exact: true });
  await openMeal('Veggie Stir-Fry');
  expect((await allToggle().textContent())?.trim()).toBe(ui('action.clear'));
  expect(await cookText()).toBe(fill('mealPlanner.shopping.cook.times', { n: '2' }));
  await page.setViewportSize(PHONE);
  await setDark(page, true);
  await allToggle().scrollIntoViewIfNeeded();
  await shot(page, '03c-meal-whos-eating-everyone-dark-phone');
  await contrastProbe(page, '03c-meal-whos-eating-everyone-dark-phone');
  await allToggle().click();
  expect((await allToggle().textContent())?.trim()).toBe(ui('common.everyone'));
  await shot(page, '03d-meal-whos-eating-cleared-dark-phone');
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);
  // Pick just Sofia and Leo, save: the subset is stored.
  await mealDrawer().getByRole('button', { name: 'Sofia' }).last().click();
  await mealDrawer().getByRole('button', { name: 'Leo' }).last().click();
  await expect.poll(cookText, { timeout: 4000 }).toBe(ui('mealPlanner.shopping.cook.once'));
  await saveMeal().click();
  await expect(mealDrawer()).toHaveCount(0, { timeout: 5000 });
  await expect
    .poll(async () => (await meals(db)).find((m) => m.id === 'mp-thu')!.eaterMemberIds, {
      timeout: 5000,
    })
    .toEqual([sofia.id, leo.id]);
  // Reopen, Everyone, save: no stored eaters (everyone).
  await openMeal('Veggie Stir-Fry');
  expect((await allToggle().textContent())?.trim()).toBe(ui('common.everyone'));
  await allToggle().click();
  expect((await allToggle().textContent())?.trim()).toBe(ui('action.clear'));
  await saveMeal().click();
  await expect(mealDrawer()).toHaveCount(0, { timeout: 5000 });
  await expect
    .poll(async () => (await meals(db)).find((m) => m.id === 'mp-thu')!.eaterMemberIds, {
      timeout: 5000,
    })
    .toBeUndefined();
  console.log('[3] thu eaters after Everyone + save: undefined (everyone)');

  // ── 4. Recipe page Shopping List (Tikka: no linked list yet) ──────────────────
  await gotoRoute(page, `/pod/cookbook/${R_TIKKA}`);
  await page.getByTestId('recipe-shopping-list-open').waitFor({ timeout: 15000 });
  await page.getByTestId('recipe-shopping-list-open').click();
  const sheet = () => page.getByRole('dialog').filter({ hasText: ui('lists.fromRecipe.title') });
  await sheet().waitFor({ timeout: 8000 });
  const vals4 = await sheet()
    .getByTestId('ingredient-text')
    .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  console.log('[4] sheet lines:', JSON.stringify(vals4));
  // The recipe's own lines, no suffix.
  expect(vals4).toEqual([
    '600 g chicken thighs',
    '1 cup plain yogurt',
    '1 yellow onion, diced',
    '1 cup basmati rice',
    'Fresh coriander, to serve',
  ]);
  await overflowProbe(page, '4 sheet desktop');
  await shotMatrix(page, '04a-recipe-sheet');
  await page.setViewportSize(PHONE);
  await overflowProbe(page, '4 sheet phone');
  await page.setViewportSize(DESKTOP);
  const c4 = (await lists(db)).length;
  await sheet()
    .getByRole('button', { name: /Create List/ })
    .click();
  await expect.poll(async () => (await lists(db)).length, { timeout: 8000 }).toBe(c4 + 1);
  const rl = (await lists(db)).find((l) => l.linkedRecipeId === R_TIKKA)!;
  console.log(
    '[4] recipe list:',
    JSON.stringify({ title: rl.title, items: rl.items.map((i) => i.title) })
  );
  await page.waitForTimeout(800);
  if (await sheet().count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByTestId('recipe-shopping-list-open').click();
  await sheet().waitFor({ timeout: 8000 });
  await expect(sheet().getByTestId('recipe-list-start-another')).toBeVisible();
  await shotMatrix(page, '04b-recipe-sheet-review');
  await page.keyboard.press('Escape');

  // ── 5. Recipe form servings stepper ─────────────────────────────────────────
  const openEdit = async (id: string) => {
    await gotoRoute(page, `/pod/cookbook/${id}`);
    const edit = page.getByRole('button', { name: ui('bean.hero.edit') }).first();
    await edit.waitFor({ timeout: 15000 });
    await edit.click();
    const f = page.getByRole('dialog').filter({ has: page.getByTestId('recipe-servings') });
    await f.waitFor({ timeout: 8000 });
    return f;
  };
  let form = await openEdit(R_MUFFIN);
  const muffinVal = await form.getByTestId('recipe-servings').inputValue();
  console.log('[5] muffins stepper value:', JSON.stringify(muffinVal));
  expect(muffinVal).toBe('');
  await shotMatrix(page, '05a-stepper-muffins-blank', () => form.getByTestId('recipe-servings'));
  const nameInput = form.getByPlaceholder(ui('recipes.placeholder.name'));
  await nameInput.fill('Blueberry Muffins Deluxe');
  await form.getByRole('button', { name: ui('action.save') }).click();
  await expect(form).toHaveCount(0, { timeout: 8000 });
  const muff = (await recipes(db)).find((r) => r.id === R_MUFFIN)!;
  console.log('[5] muffins stored:', JSON.stringify({ name: muff.name, servings: muff.servings }));
  expect(muff.name).toBe('Blueberry Muffins Deluxe');
  expect(muff.servings).toBe('12 muffins');

  form = await openEdit(R_TACOS);
  const tacoVal = await form.getByTestId('recipe-servings').inputValue();
  console.log('[5] tacos stepper value:', tacoVal);
  expect(tacoVal).toBe('4');
  await form.getByTestId('stepper-increase').click();
  await form.getByTestId('stepper-increase').click();
  expect(await form.getByTestId('recipe-servings').inputValue()).toBe('6');
  await shotMatrix(page, '05b-stepper-tacos-6', () => form.getByTestId('recipe-servings'));
  await form.getByRole('button', { name: ui('action.save') }).click();
  await expect(form).toHaveCount(0, { timeout: 8000 });
  const tac = (await recipes(db)).find((r) => r.id === R_TACOS)!;
  console.log('[5] tacos stored servings:', JSON.stringify(tac.servings), typeof tac.servings);
  expect(tac.servings).toBe('6');
  await shotMatrix(page, '05c-recipe-detail-serves');

  // ── 6. Magic beans drawer: placeholder + the "?" hint popover ABOVE the drawer ──
  // Since #119 the FAB opens the composer (no "?" hint), so the drawer is opened from the
  // To-dos page's magic beans button instead.
  await gotoRoute(page, '/todo');
  for (const [vp, vpName, dark] of [
    [PHONE, 'phone', false],
    [PHONE, 'phone', true],
    [DESKTOP, 'desktop', true],
  ] as const) {
    await page.setViewportSize(vp);
    await setDark(page, dark);
    await page.waitForTimeout(400);
    await page
      .getByRole('button', { name: new RegExp(ui('ai.magic.perform')) })
      .filter({ visible: true })
      .first()
      .click();
    const hintBtn = page
      .getByRole('button', { name: ui('common.moreInfo') })
      .filter({ visible: true });
    await hintBtn.first().waitFor({ timeout: 8000 });
    expect(await hintBtn.first().getAttribute('aria-expanded')).toBe('false');
    await hintBtn.first().click();
    expect(await hintBtn.first().getAttribute('aria-expanded')).toBe('true');
    const pop = page.getByText(ui('ai.capture.labelHint'));
    await pop.waitFor({ timeout: 4000 });
    // Topmost element at the popover's centre must be the popover itself (not the sheet).
    const onTop = await pop.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    });
    console.log(`[6] hint popover on top (${vpName}):`, onTop);
    expect(onTop).toBe(true);
    await shot(page, `06-magic-sheet-hint-${dark ? 'dark' : 'light'}-${vpName}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await setDark(page, false);

  // ── 6b. A FormFieldGroup label-extra hint beside its label: the Activity fee schedule ──
  // The hint sits OUTSIDE the faded label now, so it renders at full strength and is not part
  // of the control's accessible name.
  await page.setViewportSize(PHONE);
  await gotoRoute(page, '/activities');
  await openAddActivity(page);
  const activity = page.getByRole('dialog').filter({ visible: true }).last();
  await activity
    .getByRole('button', { name: new RegExp(ui('vacation.scheduleRecurring')) })
    .first()
    .click();
  const feeLabel = activity.getByText(ui('planner.field.feeSchedule'), { exact: true });
  await feeLabel.scrollIntoViewIfNeeded();
  const feeHint = await feeLabel.evaluate((label) => {
    const badge = label.parentElement?.querySelector('[data-testid="info-hint-trigger"]');
    let opacity = 1;
    for (let el: Element | null = badge ?? null; el; el = el.parentElement)
      opacity *= parseFloat(getComputedStyle(el).opacity);
    return { found: !!badge, insideLabel: !!badge && label.contains(badge), opacity };
  });
  console.log('[6b] fee schedule hint:', JSON.stringify(feeHint));
  expect(feeHint.found).toBe(true);
  expect(feeHint.insideLabel).toBe(false);
  expect(feeHint.opacity).toBe(1);
  for (const dark of [false, true]) {
    await setDark(page, dark);
    await feeLabel.scrollIntoViewIfNeeded();
    await shot(page, `06b-activity-fee-hint-${dark ? 'dark' : 'light'}-phone`);
  }
  await setDark(page, false);
  await page.keyboard.press('Escape');

  console.log(`[7] console errors (${consoleErrors.length}):\n  ${consoleErrors.join('\n  ')}`);
});

/**
 * The magic beans quick cards in the To-do and Activity add drawers, light + dark, cropped to
 * the card. Run once per state with `SHOT_TAG=before` / `SHOT_TAG=after` to compare the
 * `MagicBeansCardButton` extraction pixel for pixel.
 */
test('meal shopping quick cards', async ({ page }) => {
  const tag = process.env.SHOT_TAG ?? 'after';
  await page.setViewportSize(PHONE);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const card = () =>
    page
      .getByRole('dialog')
      .getByRole('button', { name: new RegExp(ui('ai.magic.perform')) })
      .filter({ visible: true })
      .first();
  for (const dark of [false, true]) {
    await setDark(page, dark);
    await gotoRoute(page, '/todo');
    await setDark(page, dark);
    await page
      .getByRole('button', { name: ui('todo.addTodo') })
      .first()
      .click();
    await card().waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await card().screenshot({
      path: `${SHOTS}/08-quickcard-todo-${tag}-${dark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await gotoRoute(page, '/activities');
    await setDark(page, dark);
    await openAddActivity(page);
    await card().waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    await card().screenshot({
      path: `${SHOTS}/08-quickcard-activity-${tag}-${dark ? 'dark' : 'light'}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
  }
});
