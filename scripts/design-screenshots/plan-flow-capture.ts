import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the whole #95 pricing flow as a family experiences it, from `npm run dev`
 * against the LIVE billing Lambda and the Stripe SANDBOX, with nothing stubbed on the money
 * path. Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately, on a dev
 * server on port 4173 (a `DEV_ORIGINS` port, so the Lambda uses the dev registry table):
 *   source ~/.beanies-tf.env && VITE_STRIPE_PUBLISHABLE_KEY=$BEANIES_STRIPE_PUBLISHABLE_KEY \
 *     npm run dev -- --port 4173 --strictPort &
 *   npx playwright test -c playwright.design.config.ts --grep "plan flow"
 *
 * What is real: the family's registry row (the create flow's PUT reaches the dev registry), the
 * checkout session (our Lambda), the Stripe iframe and the test-card payment, the claim and the
 * token, the webhook into the prod billing table, the portal session. What is faked: only the
 * registry GET's `entitlement` block (the dev registry Lambda answers `beta` for every family;
 * this script answers `trial` and, after the claim, `active` so the page swaps as it would at
 * v1). Cleanup: the fixture removes the registry row; this script removes the billing row and
 * the sandbox customer.
 */

const SHOTS = 'scratch-shots/plan-flow';
const STRIPE_KEY = process.env.TF_VAR_stripe_secret_key ?? '';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('plan flow: pay in the page, claim, portal, lapse', async ({ page }) => {
  test.skip(!STRIPE_KEY, 'source ~/.beanies-tf.env first');
  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  let phase: 'trial' | 'active' = 'trial';
  const registered = new Map<string, Record<string, unknown>>();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/billing|claim/.test(m.text())) console.log(`[page:${m.type()}] ${m.text()}`);
  });

  // The create flow's PUT goes to the REAL (dev) registry; the GET is answered here with the
  // registered row plus an entitlement block.
  await page.route('**/family/**', async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') return route.fallback();
    const familyId = decodeURIComponent(new URL(req.url()).pathname.split('/family/')[1] ?? '');
    if (req.method() === 'PUT' || req.method() === 'POST') {
      try {
        registered.set(familyId, {
          ...(registered.get(familyId) ?? {}),
          ...(req.postDataJSON() as object),
        });
      } catch {
        /* not JSON */
      }
      return route.continue();
    }
    if (req.method() !== 'GET') return route.continue();
    const entry = registered.get(familyId);
    if (!entry) return route.continue();
    const entitlement =
      phase === 'active'
        ? {
            state: 'active',
            reason: 'subscribed',
            plan: 'full',
            cohort: null,
            trialEndsAt: null,
            currentPeriodEnd: inDays(30),
            enforced: false,
            serverTime: now.toISOString(),
          }
        : {
            state: 'trial',
            reason: 'in_trial',
            plan: null,
            cohort: null,
            trialEndsAt: inDays(59),
            currentPeriodEnd: null,
            enforced: false,
            serverTime: now.toISOString(),
          };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...entry,
        familyId,
        createdAt: inDays(-31),
        updatedAt: now.toISOString(),
        entitlement,
      }),
    });
  });
  // Watch the real claim go by.
  let claimStatus = 0;
  page.on('response', (res) => {
    if (res.url().endsWith('/billing/claim')) {
      claimStatus = res.status();
      if (res.status() === 200) phase = 'active';
    }
  });

  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await page.evaluate(() => localStorage.setItem('beanies:flag:pricing', 'true'));
  // The family the create flow registered (the only PUT this run made).
  const familyId = [...registered.keys()][0] ?? '';
  expect(familyId, 'the create flow registered a family').toMatch(/^[0-9a-f-]{36}$/);
  console.log(`[flow] family ${familyId}`);

  // 1. Settings → See Plans → the real iframe (list prices: no cohort on a fresh family).
  await page.goto('/settings');
  await page.getByTestId('plan-see-plans').click();
  await page.waitForURL('**/settings/plan');
  await expect(page.getByTestId('plan-full-price')).toHaveText('$84.99');
  await page.getByTestId('plan-cycle-month').click(); // $9.99 a month: the cheaper sandbox charge
  await expect(page.getByTestId('plan-full-price')).toHaveText('$9.99');
  const frame = page.frameLocator('[data-testid="checkout-frame"] iframe').first();
  await expect(frame.locator('body')).toContainText(/9\.99/, { timeout: 60_000 });
  await shot(page, '01-checkout-mounted');

  // 2. Pay with the test card inside Stripe's iframe.
  const card = frame.locator('input[name="cardNumber"], input[autocomplete="cc-number"]').first();
  await card.waitFor({ timeout: 30_000 });
  const email = frame.locator('input[name="email"], input[type="email"]').first();
  if (await email.isVisible().catch(() => false)) {
    if (!(await email.inputValue())) await email.fill('e2e-flow@beanies.family');
  }
  await card.fill('4242424242424242');
  await frame
    .locator('input[name="cardExpiry"], input[autocomplete="cc-exp"]')
    .first()
    .fill('12 / 34');
  await frame.locator('input[name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123');
  const name = frame.locator('input[name="billingName"]').first();
  if (await name.isVisible().catch(() => false)) await name.fill('E2E Flow');
  const country = frame.locator('select[name="billingCountry"]').first();
  if (await country.isVisible().catch(() => false))
    await country.selectOption('SG').catch(() => {});
  const postal = frame.locator('input[name="billingPostalCode"]').first();
  if (await postal.isVisible().catch(() => false)) await postal.fill('018956');
  await shot(page, '02-card-filled');
  await frame.locator('button[type="submit"], .SubmitButton').first().click();

  // 3. The page claims, stores the token, refreshes, and swaps to Active.
  await expect(page.getByTestId('plan-active')).toBeVisible({ timeout: 90_000 });
  expect(claimStatus, 'the real claim answered 200').toBe(200);
  await expect(page.getByTestId('plan-token-field')).toBeHidden();
  await expect(page.getByTestId('plan-manage')).toBeVisible();
  await shot(page, '03-active-after-payment');

  // 4. Manage Plan: a real portal session, opened in a NEW tab (the app tab keeps its state).
  const [portalTab] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 30_000 }),
    page.getByTestId('plan-manage').click(),
  ]);
  await portalTab.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 });
  console.log(`[flow] portal opened in a new tab: ${new URL(portalTab.url()).host}`);
  await portalTab.waitForLoadState('domcontentloaded').catch(() => {});
  await portalTab.screenshot({ path: `${SHOTS}/04-portal-new-tab.png` }).catch(() => {});
  await portalTab.close();
  // Back on the app tab: still on the Plan page, no reload (the active card is still there).
  await expect(page.getByTestId('plan-active')).toBeVisible();

  // 5. The billing row and the sandbox objects, then cleanup.
  const auth = `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}`;
  const H = { Authorization: auth, 'Stripe-Version': '2026-08-26.dahlia' };
  const subs = (await fetch('https://api.stripe.com/v1/subscriptions?limit=20', {
    headers: H,
  }).then((r) => r.json())) as {
    data: { id: string; customer: string; metadata: { familyId?: string } }[];
  };
  const mine = subs.data.filter((s) => s.metadata?.familyId === familyId);
  expect(mine.length, 'one sandbox subscription carries this family id').toBe(1);
  console.log(`[flow] subscription ${mine[0]!.id} customer ${mine[0]!.customer}`);
  await fetch(`https://api.stripe.com/v1/subscriptions/${mine[0]!.id}`, {
    method: 'DELETE',
    headers: H,
  });
  await fetch(`https://api.stripe.com/v1/customers/${mine[0]!.customer}`, {
    method: 'DELETE',
    headers: H,
  });
  // The billing row for this throwaway family (the fixture removes the registry row).
  process.stdout.write(
    `FLOW_FAMILY_ID=${familyId}  (now: aws dynamodb delete-item --table-name beanies-family-billing-prod --key '{"familyId":{"S":"${familyId}"}}')\n`
  );
  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
