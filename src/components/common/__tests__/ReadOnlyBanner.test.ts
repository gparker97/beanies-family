/**
 * ReadOnlyBanner (#95 Phase 3): what the band says and offers, per platform.
 *
 * The rule that must never slip: iOS and Android offer Export ONLY (no link, URL, price or
 * purchase verb; Apple 3.1.3(f), Google Play payments policy), with greg's two paragraphs
 * verbatim. The web adds "See plans" only when the Plan route exists and never while stale.
 *
 * `t` returns the key, so assertions name the copy that was chosen rather than its wording.
 * Mounted with the real `ErrorBanner` and `BannerActionButton`, so the notice tone is real.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  hasRoute: vi.fn(() => true),
  native: false,
  exportEncryptedPod: vi.fn(async () => true),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: h.push, hasRoute: h.hasRoute }),
}));
// The key, except the one sentence whose number must come from the shared constant.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'readOnly.stale' ? 'readOnly.stale {days}' : key),
  }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => h.native }));
const isExporting = ref(false);
vi.mock('@/composables/usePodExport', () => ({
  usePodExport: () => ({ isExporting, exportEncryptedPod: h.exportEncryptedPod }),
}));

const store = reactive({
  isReadOnly: true,
  state: 'read_only' as string | null,
  isStale: false,
  reason: 'trial_ended' as string | null,
});
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => store }));
const auth = reactive({ needsAuth: false });
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));

import ReadOnlyBanner from '../ReadOnlyBanner.vue';
import { OFFLINE_GRACE_DAYS, PLAN_ROUTE_NAME } from '@/constants/entitlement';

const SEE_PLANS = '[data-testid="read-only-see-plans"]';
const EXPORT = '[data-testid="read-only-export"]';
const lines = (w: ReturnType<typeof mount>) =>
  w.findAll('[data-testid="read-only-banner-line"]').map((l) => l.text());

beforeEach(() => {
  vi.clearAllMocks();
  h.native = false;
  h.hasRoute.mockReturnValue(true);
  isExporting.value = false;
  auth.needsAuth = false;
  Object.assign(store, {
    isReadOnly: true,
    state: 'read_only',
    isStale: false,
    reason: 'trial_ended',
  });
});

describe('ReadOnlyBanner', () => {
  it('renders nothing for a family that is not read-only (self-gated, no outer v-if)', () => {
    store.isReadOnly = false;
    store.state = 'trial';
    expect(mount(ReadOnlyBanner).find('[role="status"]').exists()).toBe(false);
  });

  it('never renders on the lock screen, like PodAccessBanner and SaveFailureBanner', () => {
    auth.needsAuth = true;
    const w = mount(ReadOnlyBanner);
    expect(w.find('[role="status"]').exists()).toBe(false);
    expect(w.find(EXPORT).exists()).toBe(false);
  });

  it('is a notice (Heritage Orange, role=status), never an alert', () => {
    const banner = mount(ReadOnlyBanner).find('[role="status"]');
    expect(banner.exists()).toBe(true);
    expect(banner.classes()).toContain('bg-primary-500');
    expect(banner.text()).toContain('readOnly.band.title');
  });

  describe('web', () => {
    it('offers See plans and Export, with the web sentence', () => {
      const w = mount(ReadOnlyBanner);
      expect(lines(w)).toEqual(['readOnly.web.trialEnded']);
      expect(w.find(SEE_PLANS).text()).toBe('plan.action.seePlans');
      expect(w.find(EXPORT).text()).toBe('readOnly.band.export');
    });

    it('See plans goes to the Plan route', async () => {
      const w = mount(ReadOnlyBanner);
      await w.find(SEE_PLANS).trigger('click');
      expect(h.push).toHaveBeenCalledWith({ name: PLAN_ROUTE_NAME });
    });

    it('offers no See plans until the Plan route exists', () => {
      h.hasRoute.mockReturnValue(false);
      const w = mount(ReadOnlyBanner);
      expect(h.hasRoute).toHaveBeenCalledWith(PLAN_ROUTE_NAME);
      expect(w.find(SEE_PLANS).exists()).toBe(false);
      expect(w.find(EXPORT).exists()).toBe(true);
    });

    it('says the plan ended for a lapsed family', () => {
      store.reason = 'lapsed';
      expect(lines(mount(ReadOnlyBanner))).toEqual(['readOnly.lapsed']);
    });
  });

  describe('native', () => {
    beforeEach(() => {
      h.native = true;
    });

    it("offers Export ONLY, with greg's two paragraphs", () => {
      const w = mount(ReadOnlyBanner);
      expect(w.findAll('button').map((b) => b.text())).toEqual(['readOnly.band.export']);
      expect(lines(w)).toEqual(['readOnly.native.trialEnded', 'readOnly.native.plansElsewhere']);
    });

    it('never offers See plans, even with the route registered', () => {
      h.hasRoute.mockReturnValue(true);
      expect(mount(ReadOnlyBanner).find(SEE_PLANS).exists()).toBe(false);
    });
  });

  describe('stale (unconfirmed for too long)', () => {
    beforeEach(() => {
      store.isStale = true;
    });

    it('says only that the device must reconnect, naming the enforced number of days', () => {
      expect(lines(mount(ReadOnlyBanner))).toEqual([`readOnly.stale ${OFFLINE_GRACE_DAYS}`]);
    });

    it('offers no See plans on the web: the family may well be paying', () => {
      const w = mount(ReadOnlyBanner);
      expect(w.find(SEE_PLANS).exists()).toBe(false);
      expect(w.find(EXPORT).exists()).toBe(true);
    });

    it('drops the native "plans elsewhere" line: nothing needs choosing', () => {
      h.native = true;
      expect(lines(mount(ReadOnlyBanner))).toEqual([`readOnly.stale ${OFFLINE_GRACE_DAYS}`]);
    });
  });

  describe('export', () => {
    it('exports the encrypted pod', async () => {
      const w = mount(ReadOnlyBanner);
      await w.find(EXPORT).trigger('click');
      expect(h.exportEncryptedPod).toHaveBeenCalledOnce();
    });

    it('is busy (disabled, aria-busy) while an export runs', async () => {
      const w = mount(ReadOnlyBanner);
      isExporting.value = true;
      await w.vm.$nextTick();
      const btn = w.find(EXPORT);
      expect(btn.attributes('disabled')).toBeDefined();
      expect(btn.attributes('aria-busy')).toBe('true');
    });
  });

  it('carries the read-only-banner test id', () => {
    expect(mount(ReadOnlyBanner).find('[data-testid="read-only-banner"]').exists()).toBe(true);
  });
});
