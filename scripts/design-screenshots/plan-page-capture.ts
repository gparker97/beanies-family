import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the browser walk for #95 Phase 5 (the Plan page + Embedded Checkout).
 * Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   source ~/.beanies-tf.env && npx playwright test -c playwright.design.config.ts --grep "plan page"
 *
 * What it drives:
 *   1. the registry GET is answered with a chosen entitlement (trial / pre_v1, first_ten, read-only,
 *      active), so every page state renders without a real Stripe row;
 *   2. the live Lambda's `dev_origin` refusal is observed from localhost (the honest error state);
 *   3. a REAL sandbox Checkout Session (created here in Node with the sandbox key, so no prod row
 *      is written) is served to the page, and the Stripe iframe mounts inside it;
 *   4. light + dark, 1280 + 390.
 * The paid claim + webhook path is verified against the Lambda separately (see the plan Outcome).
 */

const SHOTS = 'scratch-shots/plan-page';
const STRIPE_KEY = process.env.TF_VAR_stripe_secret_key ?? '';

type Ent = {
  cancelAt?: string | null;
  pastDue?: boolean;
  state: 'beta' | 'trial' | 'active' | 'read_only';
  reason: string;
  plan: 'basic' | 'full' | null;
  cohort: 'pre_v1' | 'first_ten' | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  enforced: boolean;
  serverTime: string;
};

const now = new Date();
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const ENT: Record<string, Ent> = {
  trialPreV1: {
    state: 'trial',
    reason: 'in_trial',
    plan: null,
    cohort: 'pre_v1',
    trialEndsAt: inDays(59),
    currentPeriodEnd: null,
    enforced: false,
    serverTime: now.toISOString(),
  },
  trialFirstTen: {
    state: 'trial',
    reason: 'in_trial',
    plan: null,
    cohort: 'first_ten',
    trialEndsAt: inDays(59),
    currentPeriodEnd: null,
    enforced: false,
    serverTime: now.toISOString(),
  },
  beta: {
    state: 'beta',
    reason: 'no_launch',
    plan: null,
    cohort: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    enforced: false,
    serverTime: now.toISOString(),
  },
  readOnly: {
    state: 'read_only',
    reason: 'trial_ended',
    plan: null,
    cohort: null,
    trialEndsAt: inDays(-1),
    currentPeriodEnd: null,
    enforced: true,
    serverTime: now.toISOString(),
  },
  ending: {
    state: 'active',
    reason: 'subscribed',
    plan: 'full',
    cohort: null,
    trialEndsAt: null,
    currentPeriodEnd: inDays(364),
    cancelAt: inDays(364),
    pastDue: false,
    enforced: false,
    serverTime: now.toISOString(),
  },
  pastDue: {
    state: 'active',
    reason: 'subscribed',
    plan: 'basic',
    cohort: null,
    trialEndsAt: null,
    currentPeriodEnd: inDays(3),
    cancelAt: null,
    pastDue: true,
    enforced: false,
    serverTime: now.toISOString(),
  },
  active: {
    state: 'active',
    reason: 'subscribed',
    plan: 'full',
    cohort: 'pre_v1',
    trialEndsAt: null,
    currentPeriodEnd: inDays(364),
    enforced: false,
    serverTime: now.toISOString(),
  },
};

async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function setDark(page: Page, on: boolean) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), on);
}

/**
 * Answer every registry GET with the entry the app itself registered (captured from its PUT) plus
 * the chosen entitlement. Registered after the fixture's mock, so it wins; a fake entry with the
 * wrong provider/fileId shape would trip `checkCanonicalPod` into a sync failure.
 */
const registered = new Map<string, Record<string, unknown>>();
async function serveEntitlement(page: Page, ent: Ent) {
  await page.route('**/family/**', async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') {
      await route.fallback();
      return;
    }
    const familyId = decodeURIComponent(new URL(req.url()).pathname.split('/family/')[1] ?? '');
    if (req.method() === 'PUT' || req.method() === 'POST') {
      try {
        registered.set(familyId, {
          ...(registered.get(familyId) ?? {}),
          ...(req.postDataJSON() as object),
        });
      } catch {
        /* non-JSON: nothing to remember */
      }
      await route.fallback();
      return;
    }
    if (req.method() !== 'GET') {
      await route.fallback();
      return;
    }
    const entry = registered.get(familyId);
    if (!entry) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...entry,
        familyId,
        createdAt: inDays(-31),
        updatedAt: now.toISOString(),
        entitlement: ent,
      }),
    });
  });
}

/** A real sandbox session, created here rather than through the Lambda (which refuses localhost). */
async function createSandboxSession(familyId: string, theme: 'light' | 'dark') {
  const params = new URLSearchParams();
  params.set('ui_mode', 'embedded_page');
  params.set('redirect_on_completion', 'never');
  params.set('mode', 'subscription');
  params.set('client_reference_id', familyId);
  params.set('metadata[familyId]', familyId);
  params.set('subscription_data[metadata][familyId]', familyId);
  params.set('branding_settings[background_color]', theme === 'dark' ? '#1e2a36' : '#ffffff');
  params.set('branding_settings[button_color]', '#f15d22');
  params.set('branding_settings[border_style]', 'rounded');
  params.set('branding_settings[font_family]', 'inter');
  // The pre_v1 family's yearly full plan: the list price + the forever coupon.
  const prices = await fetch(
    'https://api.stripe.com/v1/prices?lookup_keys[0]=list.full.year.usd&active=true',
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}`,
        'Stripe-Version': '2026-08-26.dahlia',
      },
    }
  ).then((r) => r.json() as Promise<{ data: { id: string }[] }>);
  params.set('line_items[0][price]', prices.data[0]!.id);
  params.set('line_items[0][quantity]', '1');
  params.set('discounts[0][coupon]', 'PRE_V1_50');
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}`,
      'Stripe-Version': '2026-08-26.dahlia',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const json = (await res.json()) as {
    id: string;
    client_secret: string;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(`stripe: ${json.error?.message}`);
  return { sessionId: json.id, clientSecret: json.client_secret };
}

test('plan page: states, dev-origin refusal, real sandbox checkout', async ({ page }) => {
  test.skip(!STRIPE_KEY, 'source ~/.beanies-tf.env first');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /billing|entitlement/.test(m.text()))
      console.log(`[page:${m.type()}] ${m.text()}`);
  });

  await serveEntitlement(page, ENT.trialPreV1!);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await page.evaluate(() => localStorage.setItem('beanies:flag:pricing', 'true'));

  // ── 1. Settings card + See plans ──────────────────────────────────────────
  await page.goto('/settings');
  await page.getByTestId('app-content').waitFor();
  await expect(page.getByTestId('plan-card')).toBeVisible();
  await expect(page.getByTestId('plan-see-plans')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('plan-card').scrollIntoViewIfNeeded();
  await shot(page, '01-settings-card-trial-light');
  await page.getByTestId('plan-see-plans').click();
  await page.waitForURL('**/settings/plan');

  // ── 2. Plan page, trial + pre_v1: the live Lambda refuses localhost (dev_origin) ─
  await expect(page.getByTestId('plan-subtitle')).toBeVisible();
  await expect(page.getByTestId('plan-cohort-line')).toContainText('half price');
  await expect(page.getByTestId('plan-full-price')).toHaveText('$42.49');
  await expect(page.getByTestId('plan-basic-price')).toHaveText('$15');
  await expect(page.getByTestId('checkout-retry')).toBeVisible({ timeout: 30_000 });
  await shot(page, '02-plan-trial-prev1-devorigin-light');
  await page.getByTestId('plan-currency-SGD').click();
  await expect(page.getByTestId('plan-full-price')).toHaveText('S$55');
  await page.getByTestId('plan-cycle-month').click();
  await expect(page.getByTestId('plan-full-price')).toHaveText('S$6.50');
  await page.getByTestId('plan-card-basic').click();
  await expect(page.getByTestId('plan-card-basic')).toHaveAttribute('aria-checked', 'true');
  await setDark(page, true);
  await shot(page, '03-plan-trial-prev1-sgd-basic-dark');
  await setDark(page, false);

  // ── 3. A real sandbox session served to the page: the Stripe iframe mounts ──
  const familyId = await page.evaluate(() => localStorage.getItem('beanies:activeFamilyId') ?? '');
  await page.route('**/billing/checkout-session', async (route) => {
    const body = route.request().postDataJSON() as { theme: 'light' | 'dark' };
    const session = await createSandboxSession(
      familyId || '00000000-0000-4000-8000-000000000000',
      body.theme
    );
    // A theme switch or navigation can end the request mid-flight; that is not a failure.
    await route
      .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
      .catch(() => {});
  });
  // Any change of plan / interval / currency re-mounts the frame (a new session), so no retry
  // click is needed here; the watch does it.
  await page.getByTestId('plan-currency-USD').click();
  await page.getByTestId('plan-card-full').click();
  await page.getByTestId('plan-cycle-year').click();
  const frame = page.frameLocator('[data-testid="checkout-frame"] iframe').first();
  await expect(frame.locator('body')).toContainText(/42\.49|Subscribe|Pay/i, { timeout: 45_000 });
  await shot(page, '04-plan-real-checkout-light');
  await setDark(page, true);
  // A theme switch is a new session (branding is per session); wait for the re-mount.
  await expect(
    page.frameLocator('[data-testid="checkout-frame"] iframe').first().locator('body')
  ).toContainText(/42\.49|Subscribe|Pay/i, { timeout: 45_000 });
  await shot(page, '05-plan-real-checkout-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '06-plan-real-checkout-dark-phone');
  await setDark(page, false);
  await shot(page, '07-plan-real-checkout-light-phone');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.unroute('**/billing/checkout-session');
  await page.waitForTimeout(1500);

  // ── 4. first_ten, beta, read-only and active views ────────────────────────
  for (const [name, ent] of [
    ['firstten', ENT.trialFirstTen!],
    ['beta', ENT.beta!],
    ['readonly', ENT.readOnly!],
  ] as const) {
    await page.unroute('**/family/**');
    await serveEntitlement(page, ent);
    await page.goto('/settings');
    await page.getByTestId('plan-card').waitFor();
    await page.goto('/settings/plan');
    await page.getByTestId('plan-subtitle').waitFor();
    await page.waitForTimeout(1500);
    await shot(page, `08-plan-${name}-light`);
  }
  await expect(page.getByTestId('plan-full-price')).toHaveText('$84.99');

  await page.unroute('**/family/**');
  await serveEntitlement(page, ENT.active!);
  await page.goto('/settings');
  await expect(page.getByTestId('plan-manage')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('plan-card').scrollIntoViewIfNeeded();
  await shot(page, '09-settings-card-active-light');
  await page.goto('/settings/plan');
  await expect(page.getByTestId('plan-active')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('plan-manage')).toBeVisible();
  await shot(page, '10-plan-active-light');
  await setDark(page, true);
  await shot(page, '11-plan-active-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '12-plan-active-dark-phone');

  // Cancelled (ending on a date) and payment issue: the pill, the sentence, the CTA label.
  await page.setViewportSize({ width: 1280, height: 900 });
  await setDark(page, false);
  for (const [name, ent, cta] of [
    ['ending', ENT.ending!, 'Restart Plan'],
    ['pastdue', ENT.pastDue!, 'Update Card'],
  ] as const) {
    await page.unroute('**/family/**');
    await serveEntitlement(page, ent);
    await page.goto('/settings');
    await expect(page.getByTestId('plan-manage')).toHaveText(cta, { timeout: 15_000 });
    await page.getByTestId('plan-card').scrollIntoViewIfNeeded();
    await shot(page, `14-settings-card-${name}-light`);
    await page.goto('/settings/plan');
    await expect(page.getByTestId('plan-manage')).toHaveText(cta, { timeout: 15_000 });
    await shot(page, `15-plan-${name}-light`);
    await setDark(page, true);
    await shot(page, `15-plan-${name}-dark`);
    await setDark(page, false);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
});
