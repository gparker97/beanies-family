import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Locator, Page, Route } from '@playwright/test';

/**
 * NOT a test: the browser walk for magic beans to-dos + the shared result (#113, plan
 * docs/plans/2026-09-29-magic-beans-todos-and-shared-results.md, mockup layout A). Lives
 * OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "magic todos walk"
 *
 * Drives the REAL pipeline from the quick-add FAB: paste → consent → the share task's real
 * prompt builder and parser → overlay → review drawer → activity form → /todo. The ONLY stub
 * is the AI provider (BYOK, endpoint answered locally), as in statement-import-capture.ts.
 *
 * Round 2 (plan docs/plans/2026-09-29-magic-beans-todo-dedupe-and-times.md): step 1b re-reads
 * the saved field trip note (duplicates flagged, Add anyway), step 2b a to-do with a time.
 */

const SHOTS = 'screenshots/magic-todos';
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
const TRIP = addDays(14);
const TRIP_DATE = ymd(TRIP);
const SLIP_DUE = ymd(addDays(-4, TRIP));
const nextFriday = (() => {
  const d = new Date();
  const delta = (5 - d.getDay() + 7) % 7 || 7;
  return ymd(addDays(delta));
})();

const event = (title: string, date: string, link: string | null) => ({
  isEvent: true,
  title,
  date,
  startTime: '08:30',
  endTime: '14:30',
  isAllDay: false,
  location: 'Science Centre',
  description: '',
  categoryHint: 'school trip',
  category: '',
  link: link ?? '',
  confidence: { title: 0.95, date: 0.95, startTime: 0.9, endTime: 0.9, location: 0.9 },
});

const fieldTripTodos = (suffix = '', slipDue = SLIP_DUE) => ({
  items: [
    {
      title: `Return the signed permission slip${suffix}`,
      dueDate: slipDue,
      timing: null,
      assigneeName: null,
      ownerCard: 'school-forms',
      links: [],
      details: null,
    },
    {
      title: `Pay the $12 trip fee${suffix}`,
      dueDate: null,
      timing: 'before_event',
      assigneeName: null,
      ownerCard: null,
      links: ['https://portal.example-school.org/trips'],
      details: null,
    },
    {
      title: `Pack sunscreen, a hat and a packed lunch${suffix}`,
      dueDate: null,
      timing: 'on_event_day',
      assigneeName: null,
      ownerCard: null,
      links: [],
      details: null,
    },
  ],
});

const SHARED = {
  kind: 'event',
  event: event('Year 3 field trip', TRIP_DATE, 'https://portal.example-school.org/trips'),
  todo: fieldTripTodos(),
};
const SHARED_UNSAVED = {
  kind: 'event',
  event: event('Year 4 museum visit', ymd(addDays(20)), null),
  // Its own slip date: on the field trip's date the slip would (rightly) be flagged as a
  // duplicate of the field trip's slip, which is not what this step walks.
  todo: fieldTripTodos(' (museum)', ymd(addDays(16))),
};
const SHARED_DELETE = {
  kind: 'event',
  event: event('Year 5 zoo trip', ymd(addDays(25)), null),
  todo: { items: fieldTripTodos(' (zoo)', ymd(addDays(21))).items.slice(0, 2) },
};
const TODO_ONLY = {
  kind: 'todo',
  todo: {
    items: [
      {
        title: 'Return the library book',
        dueDate: nextFriday,
        timing: null,
        assigneeName: null,
        ownerCard: null,
        links: [],
        details: null,
      },
    ],
  },
};

/** The same field trip read again, with one to-do reworded the way a real re-read comes back. */
const SHARED_REREAD = {
  ...SHARED,
  todo: {
    items: SHARED.todo.items.map((it, i) =>
      i === 2 ? { ...it, title: 'Pack sunscreen, hat, and packed lunch' } : it
    ),
  },
};
const TOMORROW = ymd(addDays(1));
const TODO_TIMED = {
  kind: 'todo',
  todo: {
    items: [
      {
        title: 'Walk the dog',
        dueDate: TOMORROW,
        dueTime: '10:00',
        timing: null,
        assigneeName: null,
        ownerCard: null,
        links: [],
        details: null,
      },
    ],
  },
};

const FIELD_TRIP_TEXT = `Dear Year 3 families,
Our field trip to the Science Centre is on ${TRIP_DATE}, 8:30am to 2:30pm.
Please return the signed permission slip by ${SLIP_DUE}.
Pay the $12 trip fee on the portal: https://portal.example-school.org/trips
On the day, pack sunscreen, a hat and a packed lunch.`;

/** What the stubbed provider answers next (the share task only). */
const answer: { next: object } = { next: SHARED };

async function stubProvider(page: Page, calls: { share: number; other: number }) {
  await page.route('https://api.openai.com/v1/chat/completions', async (route: Route) => {
    const body = route.request().postDataJSON() as { messages: { content: unknown }[] };
    const system = String(body.messages[0]?.content ?? '');
    const isShare = system.includes('someone shared from another app');
    if (isShare) calls.share += 1;
    else calls.other += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(isShare ? answer.next : { kind: 'none' }) } },
        ],
      }),
    });
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

/** Light + dark at phone and desktop, leaving the page at phone/light. */
async function shotMatrix(page: Page, name: string, before?: () => Promise<void>) {
  for (const [vp, vpName] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      if (before) await before();
      await shot(page, `${name}-${dark ? 'dark' : 'light'}-${vpName}`);
    }
  }
  await setDark(page, false);
  await page.setViewportSize(PHONE);
}

/** Layout probes: sideways overflow + clipped text inside a scope. */
async function probeLayout(page: Page, scope: Locator, label: string) {
  const r = await scope.evaluate((root) => {
    const clipped: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('p, span, button, label, h3')) {
      if (el.classList.contains('truncate')) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
        clipped.push((el.textContent ?? '').trim().slice(0, 40));
    }
    return {
      pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rootOverflowsX: root.scrollWidth > root.clientWidth + 1,
      clipped,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
        (d) =>
          ((d.querySelector('h1,h2,h3') ?? d).textContent ?? '').trim().slice(0, 50) +
          (getComputedStyle(d).visibility === 'hidden' || (d as HTMLElement).offsetParent === null
            ? ' [hidden]'
            : '')
      ),
    };
  });
  console.log(`[probe] ${label}:`, JSON.stringify(r));
  return r;
}

async function openMagicAndRead(page: Page, text: string) {
  // Since #119 the FAB opens the magic beans composer in place (focused field, Send pill).
  // The composer has no kind tiles: with no hint beanies works the kind out itself.
  const sheet = page.getByTestId('quick-add-sheet');
  if (!(await sheet.isVisible())) {
    // The FAB animates continuously, so Playwright never sees it "stable": click through it.
    await page.getByRole('button', { name: 'Quick add' }).click({ force: true });
    await sheet.waitFor();
  }
  const field = sheet.getByTestId('magic-composer-field');
  await field.waitFor();
  await field.fill(text);
  await sheet.getByTestId('magic-composer-send').click();
  // First read on BYOK asks for consent.
  const consent = page.getByRole('dialog').filter({ hasText: ui('ai.consent.title') });
  const confirmBtn = consent.getByRole('button', { name: ui('ai.consent.confirm') });
  try {
    await confirmBtn.waitFor({ timeout: 4000 });
    await confirmBtn.click();
  } catch {
    /* no consent this time */
  }
}

const drawerOf = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: ui('magicTodos.title') });

async function saveActivityForm(page: Page) {
  const form = page.getByRole('dialog').filter({ hasText: ui('planner.newActivity') });
  await form.waitFor({ timeout: 15000 });
  // Who's going is required; pick one child.
  await form.getByRole('button', { name: 'Mia' }).first().click();
  await form.getByRole('button', { name: ui('modal.addActivity') }).click();
  await form.waitFor({ state: 'hidden', timeout: 15000 });
  // A plain create shows "Activity Created"; a magic capture may not.
  const ok = page.getByRole('button', { name: ui('action.ok'), exact: true });
  try {
    await ok.waitFor({ timeout: 2500 });
    await ok.click();
  } catch {
    /* no created confirm */
  }
  await page.waitForTimeout(800);
}

test('magic todos walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (
      (m.type() === 'error' && !txt.includes('Failed to load resource')) ||
      /magic-todo|magic-beans-capture|activity-delete|todos —|link_|linked|consent/.test(txt)
    )
      console.log(`[console.${m.type()}] ${txt.slice(0, 300)}`);
  });
  // Stretch the overlay's 700ms resolved hold while `__stretchResolve` is set, so the lit
  // tiles can be shot in both themes and widths.
  await page.addInitScript(() => {
    const orig = window.setTimeout;
    (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: TimerHandler,
      ms?: number,
      ...rest: unknown[]
    ) =>
      orig(
        fn,
        ms === 700 && (window as unknown as { __stretchResolve?: boolean }).__stretchResolve
          ? 9000
          : ms,
        ...rest
      )) as typeof setTimeout;
  });

  await page.setViewportSize(PHONE);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);

  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers[0]!;
  const now = new Date().toISOString();
  const bean = (id: string, name: string, color: string, ageGroup: 'adult' | 'child') =>
    ({
      id,
      name,
      color,
      ageGroup,
      email: `${id}@example.test`,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    }) as never;
  await db.seedData({
    familyMembers: [
      owner,
      bean('e2e-sofia', 'Sofia', '#ec4899', 'adult'),
      bean('e2e-mia', 'Mia', '#10b981', 'child'),
      bean('e2e-leo', 'Leo', '#3b82f6', 'child'),
    ],
    responsibilityCards: [
      {
        id: 'school-forms',
        status: 'kept',
        splitMode: 'single',
        parts: [{ key: 'main', holderId: 'e2e-sofia' }],
        createdAt: now,
        updatedAt: now,
      },
    ] as never,
    settings: {
      ...(before.settings as object),
      aiTier: 'byok',
      aiProvider: 'openai',
      aiApiKeys: { openai: 'sk-test-magic-todos' },
    } as never,
  });

  const calls = { share: 0, other: 0 };
  await stubProvider(page, calls);

  // ── 1. Shared result ─────────────────────────────────────────────────────────
  answer.next = SHARED;
  await page.evaluate(
    () => ((window as unknown as { __stretchResolve?: boolean }).__stretchResolve = true)
  );
  await openMagicAndRead(page, FIELD_TRIP_TEXT);
  const found = page.getByText('Found an activity and 3 to-dos');
  await found.waitFor({ timeout: 20000 });
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.fixed.inset-0 ul > li')].map((li) => ({
      text: (li.textContent ?? '').trim(),
      lit: ((li.firstElementChild as HTMLElement | null)?.className ?? '').includes('scale-110'),
    }))
  );
  console.log('[1] overlay tiles:', JSON.stringify(lit));
  await shotMatrix(page, '01-overlay-resolved');
  await page.evaluate(
    () => ((window as unknown as { __stretchResolve?: boolean }).__stretchResolve = false)
  );

  const drawer = drawerOf(page);
  await drawer.waitFor({ timeout: 20000 });
  await page.waitForURL(/\/activities/);
  expect(calls.share, 'one read').toBe(1);
  await expect(drawer.getByTestId('magic-todo-row')).toHaveCount(3);
  await expect(drawer.getByTestId('magic-todo-activity')).toBeVisible();
  const saveShared = drawer.getByRole('button', { name: 'Save 3 to-dos, then add the activity' });
  console.log('[1] shared save label visible:', await saveShared.isVisible().catch(() => false));
  const drawerText = (await drawer.innerText()).replace(/\s+/g, ' ');
  console.log('[1] drawer text:', drawerText.slice(0, 1200));
  const rail = await drawer.locator('.review-rail').count();
  console.log('[1] rail present:', rail);
  await probeLayout(page, drawer, 'shared drawer phone');
  await shotMatrix(page, '02-drawer-shared', async () => {
    await drawer.getByTestId('magic-todo-activity').scrollIntoViewIfNeeded();
  });
  // Scroll down to the rows + banner at phone.
  await drawer.getByTestId('magic-todo-row').last().scrollIntoViewIfNeeded();
  await shot(page, '02b-drawer-shared-rows-light-phone');
  await setDark(page, true);
  await shot(page, '02b-drawer-shared-rows-dark-phone');
  await setDark(page, false);

  // Save → activity form.
  const saveBtn = drawer.locator('button', { hasText: /Save .* to-dos|then add the activity/ });
  console.log('[1] save button text:', (await saveBtn.first().innerText()).trim());
  await saveBtn.first().click();
  const form = page.getByRole('dialog').filter({ hasText: ui('planner.newActivity') });
  await form.waitFor({ timeout: 15000 });
  await expect(drawer).toBeHidden();
  const dialogsWhileForm = await page.locator('[role="dialog"]').count();
  console.log('[1] dialogs open with the activity form:', dialogsWhileForm);
  const linkInput = form.locator('input[type="url"]');
  const linkVisible = await linkInput.isVisible().catch(() => false);
  console.log(
    '[1] link field visible:',
    linkVisible,
    'value:',
    linkVisible ? await linkInput.inputValue() : '(n/a)'
  );
  await shot(page, '03-activity-form-top-light-phone');
  if (linkVisible) await linkInput.scrollIntoViewIfNeeded();
  await shot(page, '03b-activity-form-link-light-phone');
  await setDark(page, true);
  await shot(page, '03b-activity-form-link-dark-phone');
  await setDark(page, false);

  let data = await db.exportData();
  const trip1Todos = data.todos.filter((t) =>
    [
      'Return the signed permission slip',
      'Pay the $12 trip fee',
      'Pack sunscreen, a hat and a packed lunch',
    ].includes(t.title)
  );
  console.log(
    '[1] saved to-dos before activity save:',
    JSON.stringify(
      trip1Todos.map((t) => ({
        title: t.title,
        due: t.dueDate,
        assignee:
          (t as never as { assigneeIds?: string[]; assigneeId?: string }).assigneeIds ??
          (t as never as { assigneeId?: string }).assigneeId,
        desc: t.description,
        act: (t as { activityId?: string }).activityId,
      }))
    )
  );

  await saveActivityForm(page);
  data = await db.exportData();
  const trip1 = data.activities.find((a) => a.title === 'Year 3 field trip');
  console.log(
    '[1] activity saved:',
    !!trip1,
    'link:',
    (trip1 as { link?: string } | undefined)?.link,
    'notes:',
    JSON.stringify(trip1?.notes ?? (trip1 as { description?: string } | undefined)?.description)
  );
  const linked1 = data.todos.filter((t) => (t as { activityId?: string }).activityId === trip1?.id);
  console.log('[1] to-dos linked to it:', linked1.length);

  await gotoRoute(page, '/todo');
  await page.getByTestId('app-content').waitFor();
  const chip = page.getByRole('button', { name: ui('todo.linkedActivity.open') });
  await chip
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  console.log('[1] chips on /todo:', await chip.count());
  await shot(page, '04-todo-list-chips-light-phone');
  await setDark(page, true);
  await shot(page, '04-todo-list-chips-dark-phone');
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);
  await shot(page, '04-todo-list-chips-light-desktop');
  await page.setViewportSize(PHONE);
  if (await chip.count()) {
    await chip.first().click();
    await page.waitForURL(/\/activities\?activity=/, { timeout: 10000 }).catch(() => {});
    console.log('[1] after chip click url:', page.url());
    await page.waitForTimeout(1200);
    await shot(page, '05-chip-opens-activity-light-phone');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ── 1b. Re-read the saved field trip: every to-do is flagged ────────────────
  answer.next = SHARED_REREAD;
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await openMagicAndRead(page, FIELD_TRIP_TEXT);
  await drawer.waitFor({ timeout: 20000 });
  await expect(drawer.getByTestId('magic-todo-row')).toHaveCount(3);
  const dupNotes = drawer.getByTestId('magic-todo-duplicate-note');
  await expect(dupNotes).toHaveCount(3);
  await expect(dupNotes.first()).toHaveText(ui('magicTodos.duplicate.open'));
  await expect(drawer.getByTestId('magic-todo-undo').first()).toHaveText(
    ui('magicTodos.duplicate.addAnyway')
  );
  await expect(
    drawer.getByRole('button', { name: ui('magicTodos.save.activityOnly'), exact: true })
  ).toBeVisible();
  console.log(
    '[1b] re-read drawer text:',
    (await drawer.innerText()).replace(/\s+/g, ' ').slice(0, 900)
  );
  await probeLayout(page, drawer, 're-read duplicates drawer phone');
  await shotMatrix(page, '14-drawer-duplicates', async () => {
    await drawer.getByTestId('magic-todo-row').last().scrollIntoViewIfNeeded();
  });
  // Add anyway brings one back: it is kept, and the save button counts it again.
  await drawer.getByTestId('magic-todo-undo').last().click();
  await expect(dupNotes).toHaveCount(2);
  await expect(drawer.getByTestId('magic-todo-skip')).toHaveCount(1);
  await expect(
    drawer.getByRole('button', { name: ui('magicTodos.save.shared.one'), exact: true })
  ).toBeVisible();
  await drawer.getByTestId('magic-todo-row').last().scrollIntoViewIfNeeded();
  await shot(page, '14b-drawer-add-anyway-light-phone');
  await setDark(page, true);
  await shot(page, '14b-drawer-add-anyway-dark-phone');
  await setDark(page, false);
  // Walk away: nothing from the re-read is saved.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden({ timeout: 10000 });
  data = await db.exportData();
  console.log(
    '[1b] field trip to-dos after closing the re-read:',
    data.todos.filter((t) => /permission slip$|trip fee$|packed lunch$/.test(t.title)).length
  );

  // ── 2. To-do only ────────────────────────────────────────────────────────────
  answer.next = TODO_ONLY;
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await openMagicAndRead(page, 'Please return the library book by Friday.');
  await drawer.waitFor({ timeout: 20000 });
  await page.waitForURL(/\/todo/);
  await expect(drawer.getByTestId('magic-todo-row')).toHaveCount(1);
  console.log(
    '[2] to-do only drawer text:',
    (await drawer.innerText()).replace(/\s+/g, ' ').slice(0, 600)
  );
  console.log('[2] rail present:', await drawer.locator('.review-rail').count());
  const saveOne = drawer.getByRole('button', { name: 'Save 1 to-do' });
  const saveOneCls = await saveOne.getAttribute('class');
  console.log('[2] save "Save 1 to-do" classes:', saveOneCls);
  await probeLayout(page, drawer, 'todo-only drawer phone');
  await shotMatrix(page, '06-drawer-todo-only');
  // Skip → save disabled; undo.
  await drawer.getByTestId('magic-todo-skip').click();
  console.log(
    '[2] save disabled when all skipped:',
    await drawer
      .locator('button', { hasText: /Save 0 to-dos|Save .* to-do/ })
      .first()
      .isDisabled()
  );
  await shot(page, '06b-drawer-todo-only-skipped-light-phone');
  await drawer.getByTestId('magic-todo-undo').click();
  await saveOne.click();
  await expect(drawer).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(600);
  data = await db.exportData();
  const lib = data.todos.find((t) => t.title === 'Return the library book');
  console.log(
    '[2] library to-do:',
    JSON.stringify(lib && { due: lib.dueDate, act: (lib as { activityId?: string }).activityId })
  );
  await shot(page, '07-todo-only-saved-light-phone');

  // ── 2b. A to-do with a stated time keeps it ─────────────────────────────────
  answer.next = TODO_TIMED;
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await openMagicAndRead(page, 'Remind me to walk the dog tomorrow at 10am');
  await drawer.waitFor({ timeout: 20000 });
  await expect(drawer.getByTestId('magic-todo-row')).toHaveCount(1);
  const timeField = drawer.getByTestId('magic-todo-time');
  await expect(timeField.getByTestId('time-preset-picker-trigger')).toHaveText(/10:00 AM/);
  await expect(timeField.getByTestId('time-preset-picker-clear')).toBeVisible();
  await expect(drawer.getByTestId('magic-todo-duplicate-note')).toHaveCount(0);
  await probeLayout(page, drawer, 'timed to-do drawer phone');
  await shotMatrix(page, '15-drawer-due-time');
  await drawer.getByRole('button', { name: 'Save 1 to-do' }).click();
  await expect(drawer).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(600);
  data = await db.exportData();
  const dog = data.todos.find((t) => t.title === 'Walk the dog');
  console.log('[2b] dog to-do:', JSON.stringify(dog && { due: dog.dueDate, time: dog.dueTime }));
  expect(dog?.dueDate).toBe(TOMORROW);
  expect(dog?.dueTime).toBe('10:00');

  // ── 3. Unsaved close ─────────────────────────────────────────────────────────
  answer.next = SHARED_UNSAVED;
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await openMagicAndRead(page, FIELD_TRIP_TEXT.replace('Science Centre', 'museum'));
  await drawer.waitFor({ timeout: 20000 }).catch(async (e) => {
    await shot(page, 'zz-step3-no-drawer');
    throw e;
  });
  await drawer
    .locator('button', { hasText: /then add the activity/ })
    .first()
    .click();
  const form3 = page.getByRole('dialog').filter({ hasText: ui('planner.newActivity') });
  await form3.waitFor({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  // A discard confirm may appear.
  const dialogsAfterEsc = await page.locator('[role="dialog"]').count();
  console.log('[3] dialogs after Escape on the form:', dialogsAfterEsc);
  if (dialogsAfterEsc > 0) {
    await shot(page, '08-unsaved-close-after-esc-light-phone');
    const discard = page.getByRole('button', { name: /discard|close|leave|yes/i });
    if (await discard.count()) await discard.first().click();
    await page.waitForTimeout(500);
  }
  data = await db.exportData();
  const museum = data.todos.filter((t) => t.title.endsWith('(museum)'));
  console.log(
    '[3] museum to-dos:',
    museum.length,
    'linked:',
    museum.filter((t) => (t as { activityId?: string }).activityId).length,
    'museum activity exists:',
    data.activities.some((a) => a.title === 'Year 4 museum visit')
  );
  await gotoRoute(page, '/todo');
  await page.getByTestId('app-content').waitFor();
  await page
    .getByText('Return the signed permission slip (museum)')
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await shot(page, '09-unsaved-close-todos-light-phone');

  // ── 4. Delete with linked to-dos: Keep ───────────────────────────────────────
  if (trip1) {
    await gotoRoute(page, `/activities?activity=${trip1.id}`);
    await page.getByTestId('app-content').waitFor();
    const del = page.getByTestId('form-modal-delete');
    await del.waitFor({ timeout: 10000 });
    await shot(page, '10-activity-view-light-phone');
    await del.click();
    const confirmDlg = page
      .getByRole('dialog')
      .filter({ hasText: ui('planner.deleteLinkedTodos.title') });
    await confirmDlg.waitFor({ timeout: 10000 });
    const choices = page.getByTestId('confirm-choices');
    console.log('[4] choices:', (await choices.innerText()).replace(/\s+/g, ' '));
    console.log('[4] checked radio:', await choices.locator('input:checked').getAttribute('value'));
    console.log(
      '[4] dialogs open with the confirm:',
      await page.locator('[role="dialog"]').count()
    );
    await probeLayout(page, confirmDlg, 'delete confirm phone');
    await shotMatrix(page, '11-delete-confirm');
    await confirmDlg.getByRole('button', { name: ui('action.delete') }).click();
    await page.waitForTimeout(1200);
    data = await db.exportData();
    const kept = data.todos.filter((t) => (t as { activityId?: string }).activityId === trip1.id);
    console.log(
      '[4] activity gone:',
      !data.activities.some((a) => a.id === trip1.id),
      'to-dos kept:',
      kept.length
    );
    await gotoRoute(page, '/todo');
    await page.getByTestId('app-content').waitFor();
    console.log(
      '[4] chips on /todo after Keep:',
      await page.getByRole('button', { name: ui('todo.linkedActivity.open') }).count()
    );
    await shot(page, '12-after-keep-todos-light-phone');
  }

  // ── 5. Delete with linked to-dos: Delete too ─────────────────────────────────
  answer.next = SHARED_DELETE;
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await openMagicAndRead(page, FIELD_TRIP_TEXT.replace('Science Centre', 'zoo'));
  await drawer.waitFor({ timeout: 20000 });
  await drawer
    .locator('button', { hasText: /then add the activity/ })
    .first()
    .click();
  await saveActivityForm(page);
  data = await db.exportData();
  const zoo = data.activities.find((a) => a.title === 'Year 5 zoo trip');
  console.log(
    '[5] zoo linked to-dos:',
    data.todos.filter((t) => (t as { activityId?: string }).activityId === zoo?.id).length
  );
  if (zoo) {
    await gotoRoute(page, `/activities?activity=${zoo.id}`);
    await page.getByTestId('app-content').waitFor();
    await page.getByTestId('form-modal-delete').click();
    const confirmDlg = page
      .getByRole('dialog')
      .filter({ hasText: ui('planner.deleteLinkedTodos.title') });
    await confirmDlg.waitFor({ timeout: 10000 });
    await page.getByTestId('confirm-choices').locator('label').nth(1).click();
    await shot(page, '13-delete-too-selected-light-phone');
    await setDark(page, true);
    await shot(page, '13-delete-too-selected-dark-phone');
    await setDark(page, false);
    await confirmDlg.getByRole('button', { name: ui('action.delete') }).click();
    await page.waitForTimeout(1200);
    data = await db.exportData();
    console.log(
      '[5] zoo gone:',
      !data.activities.some((a) => a.id === zoo.id),
      'zoo to-dos left:',
      data.todos.filter((t) => t.title.endsWith('(zoo)')).length
    );
  }

  console.log('[calls]', JSON.stringify(calls));
});

/** The approved mockup, rendered for side-by-side comparison. */
test('magic todos mockup', async ({ page }) => {
  for (const [vp, name] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    await page.goto(
      `file://${process.cwd()}/docs/mockups/magic-beans-todos-shared-2026-09-29.html`
    );
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/00-mockup-${name}.png`, fullPage: true });
  }
});
