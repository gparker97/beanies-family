import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page, Route } from '@playwright/test';

/**
 * NOT a test: the browser walk for the bank-statement import (#107, plan
 * docs/plans/2026-09-25-statement-import-review-and-reconcile.md). Lives OUTSIDE `e2e/specs/`
 * on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "statement import"
 *
 * Drives the REAL pipeline end to end: the Budget page's "Import a statement" tile opens the
 * magic-beans sheet pre-picked, a pasted statement goes through the statement consent, the
 * spine's statement branch, the real prompt builder and the real parser, into the review drawer
 * and the atomic commit. The ONLY stub is the AI provider: the family is put on BYOK and the
 * provider's endpoint is answered locally with a synthetic statement read (no real statement
 * data, which is PII, is ever used here).
 */

const SHOTS = 'scratch-shots/statement-import';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** A synthetic SCB-shaped read: a familiar utility bill, a counterpart payment, a foreign
 *  amount, two identical same-day lines, a refund, and a possible duplicate (Cowork Hub, against a
 *  hand-entered row 15 days later with a slightly different amount). */
const STATEMENT_READ = {
  isStatement: true,
  account: {
    institution: 'Standard Chartered',
    last4: '0042',
    currency: 'SGD',
    kind: 'card',
  },
  period: { from: '2026-08-20', to: '2026-09-18' },
  balances: { opening: 4820.55, closing: 3000 },
  lines: [
    {
      date: '2026-08-24',
      description: 'SKYWAYAIR0001234 SINGAPORE SG',
      merchant: 'Skyway Air',
      amount: 91,
      direction: 'in',
      kind: 'refund',
      category: 'refunds',
    },
    {
      date: '2026-09-01',
      description: 'CITYPOWER UTIL SINGAPORE SG',
      merchant: 'CityPower utilities',
      amount: 604.12,
      direction: 'out',
      kind: 'purchase',
      category: 'utilities',
    },
    {
      date: '2026-09-01',
      description: 'COWORK HUB CENTRAL SINGAPORE SG',
      merchant: 'Cowork Hub Central',
      amount: 352.4,
      direction: 'out',
      kind: 'purchase',
      category: 'other_expense',
    },
    {
      date: '2026-09-02',
      description: 'RIDEGO RIDES KUALA LUMPUR MY',
      merchant: 'RideGo rides',
      amount: 33.18,
      direction: 'out',
      kind: 'purchase',
      original: { amount: 101.3, currency: 'MYR' },
      category: 'taxi',
    },
    {
      date: '2026-09-11',
      description: 'GIRO PAYMENT',
      merchant: 'GIRO payment',
      amount: 4820.55,
      direction: 'in',
      kind: 'payment',
      category: '',
    },
    {
      date: '2026-09-12',
      description: 'BURGER BARN SINGAPORE SG',
      merchant: 'Burger Barn',
      amount: 27.5,
      direction: 'out',
      kind: 'purchase',
      category: 'dining_out',
    },
    {
      date: '2026-09-12',
      description: 'BURGER BARN SINGAPORE SG',
      merchant: 'Burger Barn',
      amount: 27.5,
      direction: 'out',
      kind: 'purchase',
      category: 'dining_out',
    },
  ],
  confidence: { overall: 0.92 },
};

const PASTED = [
  '20 Aug 24 Aug SKYWAYAIR0001234 SINGAPORE SG 91.00CR',
  '01 Sep 03 Sep CITYPOWER UTIL SINGAPORE SG 604.12',
  '01 Sep 02 Sep COWORK HUB CENTRAL SINGAPORE SG 352.40',
  '02 Sep 03 Sep RIDEGO RIDES KUALA LUMPUR MY MYR 101.30 33.18',
  '11 Sep 11 Sep GIRO PAYMENT 4,820.55CR',
  '12 Sep 14 Sep BURGER BARN SINGAPORE SG 27.50',
  '12 Sep 14 Sep BURGER BARN SINGAPORE SG 27.50',
].join('\n');

/** The BYOK provider endpoint, answered locally. Counts statement reads. */
/** While `hold` is set, a statement read waits on it: the reading overlay stays up for a shot. */
const gate: { hold: Promise<void> | null } = { hold: null };

async function stubProvider(page: Page, calls: { statement: number; other: number }) {
  await page.route('https://api.openai.com/v1/chat/completions', async (route: Route) => {
    const body = route.request().postDataJSON() as { messages: { content: unknown }[] };
    const system = String(body.messages[0]?.content ?? '');
    const isStatement = system.includes('bank or card statement, and return every transaction');
    if (isStatement) calls.statement += 1;
    else calls.other += 1;
    // The merchant memory must be in the SYSTEM message, never the user message (#107).
    if (isStatement) expect(system).toContain('→');
    if (isStatement && gate.hold) await gate.hold;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(isStatement ? STATEMENT_READ : { kind: 'none' }) } },
        ],
      }),
    });
  });
}

async function importStatement(page: Page) {
  // `gotoRoute`, never a bare `page.goto`: it stages the live doc first, so the seed survives
  // the full-page load.
  await gotoRoute(page, '/budgets');
  await page.getByTestId('app-content').waitFor();
  const tile = page.getByRole('button', { name: /import a statement/i });
  await tile.scrollIntoViewIfNeeded();
  await shot(page, 'light-phone-0-budget-tile');
  await tile.click();
  const field = page.locator('textarea').first();
  await field.waitFor();
  await field.fill(PASTED);
  await page.getByRole('button', { name: ui('ai.capture.action') }).click();
}

test('statement import walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[console.${m.type()}] ${m.text()}`);
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);

  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const ownerId = before.familyMembers[0]!.id;
  const now = new Date().toISOString();
  const account = (id: string, name: string, type: string, extra: object = {}) => ({
    id,
    memberId: ownerId,
    name,
    type,
    currency: 'SGD',
    balance: type === 'credit_card' ? 4820.55 : 20000,
    isActive: true,
    includeInNetWorth: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  await db.seedData({
    accounts: [
      account('acc-card', 'SCB Visa Infinite', 'credit_card', {
        institution: 'Standard Chartered',
        cardLast4: '0042',
      }),
      account('acc-savings', 'DBS Savings', 'savings', { institution: 'DBS' }),
    ] as never,
    recurringItems: [
      {
        id: 'rec-utilities',
        accountId: 'acc-card',
        type: 'expense',
        amount: 600,
        currency: 'SGD',
        category: 'utilities',
        description: 'Electricity & water',
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: '2026-09-01',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ] as never,
    transactions: [
      {
        id: 'tx-card-bill',
        accountId: 'acc-savings',
        type: 'expense',
        amount: 4820.55,
        currency: 'SGD',
        category: 'debt_payment',
        date: '2026-09-10',
        description: 'Credit card bill',
        isReconciled: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        // greg's case: entered by hand, close amount, 15 days from the statement line, no word
        // in common. Must show as a POSSIBLE duplicate that keeps both by default.
        id: 'tx-desk-by-hand',
        accountId: 'acc-card',
        type: 'expense',
        amount: 352,
        currency: 'SGD',
        category: 'rent',
        date: '2026-09-16',
        description: 'Coworking desk',
        isReconciled: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tx-coffee-history',
        accountId: 'acc-card',
        type: 'expense',
        amount: 6.5,
        currency: 'SGD',
        category: 'coffee',
        date: '2026-08-02',
        description: 'Starbucks',
        isReconciled: false,
        createdAt: now,
        updatedAt: now,
      },
    ] as never,
    // The Budget page shows its "Add transactions" card (and so the import tile) only once a
    // budget exists.
    budgets: [
      {
        id: 'budget-1',
        mode: 'fixed',
        totalAmount: 5000,
        currency: 'SGD',
        categories: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: {
      ...(before.settings as object),
      aiTier: 'byok',
      aiProvider: 'openai',
      aiApiKeys: { openai: 'sk-test-statement-import' },
    } as never,
  });

  const calls = { statement: 0, other: 0 };
  await stubProvider(page, calls);

  // 1. Budget tile → sheet pre-picked → paste → the statement consent, with its count.
  await importStatement(page);
  const consent = page.getByRole('dialog').filter({ hasText: ui('ai.consent.statement.title') });
  await consent.waitFor();
  await expect(consent).toContainText('1 read, one bean.');
  await expect(consent).toContainText('names of shops and payees');
  await shot(page, 'light-phone-1-consent');
  await consent.getByRole('button', { name: ui('ai.consent.statement.confirm') }).click();

  // 2. The review drawer, on the Transactions page.
  const drawer = page.getByRole('dialog').filter({ hasText: ui('statementImport.title') });
  await drawer.waitFor({ timeout: 30000 });
  await page.waitForURL(/\/transactions/);
  expect(calls.statement, 'one text chunk is one read').toBe(1);
  expect(calls.other, 'a stated statement never makes a classify read').toBe(0);
  await shot(page, 'light-phone-2-review-top');

  // The account was suggested from the statement's last 4 digits.
  await expect(
    drawer.getByRole('combobox', { name: ui('statementImport.account.label') })
  ).toHaveValue('acc-card');
  // The utility bill is a pair card against the recurring bill; the card bill is a pair card
  // against the savings account's expense (a counterpart transfer).
  await expect(drawer.getByText('Electricity & water')).toBeVisible();
  await expect(drawer.getByText('Credit card bill')).toBeVisible();
  await drawer.getByText('Credit card bill').scrollIntoViewIfNeeded();
  await shot(page, 'light-phone-3-pairs');
  await drawer.getByText('Burger Barn').first().scrollIntoViewIfNeeded();
  await shot(page, 'light-phone-4-rows');
  // The hand-entered desk is a POSSIBLE duplicate: shown, counted, kept both by default.
  await expect(drawer.getByText(ui('statementImport.pair.possible'))).toBeVisible();
  await expect(drawer.getByText('1 possible duplicate')).toBeVisible();
  await drawer.getByText('Coworking desk').scrollIntoViewIfNeeded();
  await shot(page, 'light-phone-4b-possible');

  // 3. Bulk: untick all, then tick all restores the defaults (familiar back to merge).
  await drawer.getByRole('button', { name: ui('statementImport.bulk.untickAll') }).click();
  await expect(
    page.getByRole('button', { name: ui('statementImport.confirm.nothing') })
  ).toBeDisabled();
  await drawer.getByRole('button', { name: ui('statementImport.bulk.tickAll') }).click();
  await expect(page.getByRole('button', { name: /Add 5, Merge 2/ })).toBeVisible();

  // 4. Dark, and desktop, on the same open drawer.
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await drawer.getByText('Electricity & water').scrollIntoViewIfNeeded();
  await shot(page, 'dark-phone-3-pairs');
  await drawer.getByText('Burger Barn').first().scrollIntoViewIfNeeded();
  await shot(page, 'dark-phone-4-rows');
  await drawer.getByText('Coworking desk').scrollIntoViewIfNeeded();
  await shot(page, 'dark-phone-4b-possible');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'dark-desktop-review');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await shot(page, 'light-desktop-review');
  await page.setViewportSize({ width: 360, height: 780 });

  // 5. Commit.
  await page.getByRole('button', { name: /Add 5, Merge 2/ }).click();
  await drawer.waitFor({ state: 'hidden', timeout: 30000 });
  await shot(page, 'light-phone-5-after');

  const after = await db.exportData();
  const imported = after.transactions.filter((t) => t.importFingerprint);
  console.log(
    'imported/merged rows:',
    JSON.stringify(
      imported.map((t) => ({
        d: t.description,
        type: t.type,
        amt: t.amount,
        acct: t.accountId,
        to: t.toAccountId,
        rec: t.isReconciled,
        onStatement: t.statementDescription,
      })),
      null,
      1
    )
  );
  expect(imported.length, '5 adds + 2 merges carry a fingerprint').toBe(7);
  expect(imported.every((t) => t.isReconciled)).toBe(true);
  // The recurring bill was merged, not duplicated: one September instance, statement amount.
  const utilities = after.transactions.filter((t) => t.recurringItemId === 'rec-utilities');
  expect(utilities.length).toBe(1);
  expect(utilities[0]!.amount).toBe(604.12);
  expect(utilities[0]!.statementDescription).toBe('CITYPOWER UTIL SINGAPORE SG');
  // The card bill became ONE transfer from savings to the card.
  const bill = after.transactions.find((t) => t.id === 'tx-card-bill')!;
  expect(bill.type).toBe('transfer');
  expect(bill.accountId).toBe('acc-savings');
  expect(bill.toAccountId).toBe('acc-card');
  // The possible duplicate kept both: the hand-entered row is untouched.
  const desk = after.transactions.find((t) => t.id === 'tx-desk-by-hand')!;
  expect(desk).toMatchObject({ amount: 352, description: 'Coworking desk' });
  expect(desk.importFingerprint).toBeUndefined();
  // The two identical Burger Barn lines are two transactions.
  expect(after.transactions.filter((t) => t.description === 'Burger Barn').length).toBe(2);

  // 6. Re-import the same statement: every line is already added, nothing is offered.
  await importStatement(page);
  const consent2 = page.getByRole('dialog').filter({ hasText: ui('ai.consent.statement.title') });
  await consent2.waitFor();
  await consent2.getByRole('button', { name: ui('ai.consent.statement.confirm') }).click();
  await drawer.waitFor({ timeout: 30000 });
  await expect(
    page.getByRole('button', { name: ui('statementImport.confirm.nothing') })
  ).toBeDisabled();
  await shot(page, 'light-phone-6-reimport');
  await drawer.getByText('Burger Barn').first().scrollIntoViewIfNeeded();
  await shot(page, 'light-phone-7-reimport-rows');
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });

  // 7. Transactions page: the magic-beans pill in the header, and the card in the add drawer.
  await gotoRoute(page, '/transactions');
  await page.getByTestId('app-content').waitFor();
  const pill = page.getByRole('button', { name: ui('transactions.magicAria') });
  await expect(pill).toBeVisible();
  await shot(page, 'light-phone-8-page-pill');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'light-desktop-8-page-pill');
  await page.setViewportSize({ width: 360, height: 780 });

  await page
    .getByRole('button', { name: ui('transactions.addTransaction') })
    .first()
    .click();
  const addDrawer = page.getByRole('dialog').filter({ hasText: ui('transactions.magicHint') });
  await addDrawer.waitFor();
  await shot(page, 'light-phone-9-add-drawer');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await shot(page, 'dark-phone-9-add-drawer');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  // 8. From the drawer's card: sheet (Transactions pre-picked) → consent → the reading overlay,
  //    held open for its tiles, then the review replaces the add drawer.
  let release!: () => void;
  gate.hold = new Promise<void>((r) => (release = r));
  await addDrawer.getByRole('button', { name: new RegExp(ui('ai.magic.perform'), 'i') }).click();
  const field = page.locator('textarea').last();
  await field.waitFor();
  await field.fill(PASTED);
  await page.getByRole('button', { name: ui('ai.capture.action') }).click();
  const consent3 = page.getByRole('dialog').filter({ hasText: ui('ai.consent.statement.title') });
  await consent3.waitFor();
  await consent3.getByRole('button', { name: ui('ai.consent.statement.confirm') }).click();
  await page.getByText(ui('ai.reading.statement')).waitFor();
  await shot(page, 'light-phone-10-overlay');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await shot(page, 'dark-phone-10-overlay');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'dark-desktop-10-overlay');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await shot(page, 'light-desktop-10-overlay');
  await page.setViewportSize({ width: 360, height: 780 });
  gate.hold = null;
  release();
  await drawer.waitFor({ timeout: 30000 });
  await expect(addDrawer).toBeHidden();
  await shot(page, 'light-phone-11-review-from-drawer');
});
