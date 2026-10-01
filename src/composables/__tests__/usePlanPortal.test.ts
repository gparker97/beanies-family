/**
 * usePlanPortal (#95 Phase 5): when Manage/Receipts are offered, that the portal opens in the
 * same tab with the token from settings, that a missing token routes to the Plan page instead
 * of a button that 403s, and that a failure is a toast plus a reported error, never a throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, reactive } from 'vue';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  createPortalSession: vi.fn(),
  showToast: vi.fn(),
  reportError: vi.fn(),
  logEvent: vi.fn(),
  assign: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  native: false,
}));

const entitlement = reactive({
  state: 'active' as string | null,
  isStale: false,
  refresh: (...a: unknown[]) => h.refresh(...a),
});
const settings = reactive({ settings: { planToken: 'tok' as string | undefined } });
const family = reactive({ activeFamilyId: 'fam-1' as string | null });

vi.mock('vue-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => entitlement }));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => family }));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => h.native }));
vi.mock('@/services/billing/billingApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/billing/billingApi')>(
    '@/services/billing/billingApi'
  );
  return { ...actual, createPortalSession: h.createPortalSession };
});
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import { usePlanPortal } from '../usePlanPortal';
import { BillingApiError } from '@/services/billing/billingApi';

function use() {
  const scope = effectScope();
  const api = scope.run(() => usePlanPortal())!;
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.native = false;
  entitlement.state = 'active';
  entitlement.isStale = false;
  settings.settings.planToken = 'tok';
  family.activeFamilyId = 'fam-1';
  vi.stubGlobal('location', { assign: h.assign });
  vi.stubGlobal('open', h.open);
  h.refresh.mockResolvedValue(undefined);
});

/** A blank tab as `window.open` returns it. */
function fakeTab() {
  return { opener: {} as unknown, closed: false, location: { href: '' }, close: vi.fn() };
}

describe('usePlanPortal', () => {
  it('offers Manage on the web for an active, fresh plan only', () => {
    expect(use().showManage.value).toBe(true);
    entitlement.isStale = true;
    expect(use().showManage.value).toBe(false);
    entitlement.isStale = false;
    entitlement.state = 'trial';
    expect(use().showManage.value).toBe(false);
    entitlement.state = 'active';
    h.native = true;
    expect(use().showManage.value).toBe(false);
  });

  it('opens a blank tab inside the click, then points it at the portal (opener severed)', async () => {
    const tab = fakeTab();
    h.open.mockReturnValue(tab);
    h.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/s' });
    await use().openPortal();
    expect(h.open).toHaveBeenCalledWith('', '_blank');
    expect(h.createPortalSession).toHaveBeenCalledWith({ familyId: 'fam-1', planToken: 'tok' });
    expect(tab.location.href).toBe('https://billing.stripe.com/p/s');
    expect(tab.opener).toBeNull();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'portal_opened', detail: 'new_tab' } })
    );
  });

  it('falls back to the same tab when the popup is blocked', async () => {
    h.open.mockReturnValue(null);
    h.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/s' });
    await use().openPortal();
    expect(h.assign).toHaveBeenCalledWith('https://billing.stripe.com/p/s');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'portal_opened', detail: 'same_tab' } })
    );
  });

  it('closes the blank tab when the portal session fails', async () => {
    const tab = fakeTab();
    h.open.mockReturnValue(tab);
    h.createPortalSession.mockRejectedValue(new Error('boom'));
    await use().openPortal();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('forces ONE entitlement refresh the first time the tab is visible again after the portal, then re-asks for the webhook', async () => {
    vi.useFakeTimers();
    h.open.mockReturnValue(fakeTab());
    h.createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p/s' });
    await use().openPortal();
    expect(h.refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.refresh).toHaveBeenCalledWith({ force: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    // Two follow-up asks cover the webhook's latency; still forced, still one-shot.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    expect(h.refresh).toHaveBeenLastCalledWith({ force: true });
    vi.useRealTimers();
  });

  it('a missing token pages (critical) and tells the family calmly; it never navigates', async () => {
    settings.settings.planToken = undefined;
    const api = use();
    expect(api.hasToken.value).toBe(false);
    await api.openPortal();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.createPortalSession).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: { action: 'portal_failed', error_code: 'token_missing' },
      })
    );
    expect(h.showToast).toHaveBeenCalledWith(
      'error',
      'plan.error.portalUnavailable.title',
      'plan.error.portalUnavailable.badToken'
    );
  });

  it('a failure is a toast and a reported error with the code, and bad_token gets its own copy', async () => {
    h.open.mockReturnValue(fakeTab());
    h.createPortalSession.mockRejectedValue(new BillingApiError('bad_token', 403));
    await use().openPortal();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.showToast).toHaveBeenCalledWith(
      'error',
      'plan.error.portalUnavailable.title',
      'plan.error.portalUnavailable.badToken'
    );
    // Not the family's problem to fix: it pages, with the refund-and-resubscribe recovery.
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: { action: 'portal_failed', error_code: 'bad_token', http_status: 403 },
      })
    );
    h.createPortalSession.mockRejectedValue(new Error('boom'));
    await use().openPortal();
    expect(h.showToast).toHaveBeenLastCalledWith(
      'error',
      'plan.error.portalUnavailable.title',
      'plan.error.portalUnavailable.message'
    );
  });
});
