import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the settings store so we control aiTier + aiProvider + aiApiKeys without Pinia.
// Phase 4: the composable reads the PERSISTED tier (settingsStore.aiTier), not a derived one.
const storeState = {
  aiTier: 'managed' as 'managed' | 'byok' | 'on-device',
  aiProvider: 'none' as 'none' | 'openai' | 'claude' | 'gemini',
  settings: { aiApiKeys: {} as Record<string, string | undefined> },
};
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => storeState,
}));

// #95: the read-only refusal. Only `isReadOnly` is read; the store is mocked, never edited.
const h = vi.hoisted(() => ({
  entitlement: { isReadOnly: false },
  showToast: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock('@/stores/entitlementStore', () => ({ useEntitlementStore: () => h.entitlement }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import { useAiCapability } from '../useAiCapability';

beforeEach(() => {
  vi.clearAllMocks();
  h.entitlement.isReadOnly = false;
  delete (storeState.settings as { planToken?: string }).planToken;
  storeState.aiTier = 'managed';
  storeState.aiProvider = 'none';
  storeState.settings.aiApiKeys = {};
});

describe('useAiCapability', () => {
  it('returns the persisted managed tier (always selectable, no client key)', () => {
    const { tier, byokConfig, isConfigured } = useAiCapability();
    expect(tier.value).toBe('managed');
    expect(byokConfig.value).toBeNull();
    expect(isConfigured.value).toBe(true);
  });

  it('builds a BYOK config when tier=byok AND a matching key is set', () => {
    storeState.aiTier = 'byok';
    storeState.aiProvider = 'openai';
    storeState.settings.aiApiKeys = { openai: 'sk-test' };

    const { tier, byokConfig, isConfigured } = useAiCapability();
    expect(tier.value).toBe('byok');
    expect(byokConfig.value).toEqual({ provider: 'openai', apiKey: 'sk-test' });
    expect(isConfigured.value).toBe(true);
  });

  it('byok without a key → no config, not configured', () => {
    storeState.aiTier = 'byok';
    storeState.aiProvider = 'gemini';
    storeState.settings.aiApiKeys = {}; // no gemini key

    const { tier, byokConfig, isConfigured } = useAiCapability();
    expect(tier.value).toBe('byok');
    expect(byokConfig.value).toBeNull();
    expect(isConfigured.value).toBe(false);
  });

  it('reads the key for the selected provider, not another', () => {
    storeState.aiTier = 'byok';
    storeState.aiProvider = 'claude';
    storeState.settings.aiApiKeys = { openai: 'sk-openai' }; // wrong provider's key

    const { byokConfig } = useAiCapability();
    expect(byokConfig.value).toBeNull();
  });

  it('does not build a BYOK config on the managed tier even if a key happens to be stored', () => {
    storeState.aiTier = 'managed';
    storeState.aiProvider = 'openai';
    storeState.settings.aiApiKeys = { openai: 'sk-test' };

    const { byokConfig } = useAiCapability();
    expect(byokConfig.value).toBeNull(); // only tier=byok uses a client key
  });

  it('on-device tier is a future stub → not configured', () => {
    storeState.aiTier = 'on-device';

    const { tier, byokConfig, isConfigured } = useAiCapability();
    expect(tier.value).toBe('on-device');
    expect(byokConfig.value).toBeNull();
    expect(isConfigured.value).toBe(false);
  });

  describe('the magic-beans plan token and read-only refusal (#95)', () => {
    const grant = {} as Parameters<
      ReturnType<typeof useAiCapability>['extractOptions']
    >[0]['grant'];

    it('extractOptions carries the plan token from settings when present', () => {
      (storeState.settings as { planToken?: string }).planToken = 'tok-1';
      const opts = useAiCapability().extractOptions({ grant, familyId: 'fam-1' });
      expect(opts.planToken).toBe('tok-1');
    });

    it('extractOptions omits it when the family has none', () => {
      const opts = useAiCapability().extractOptions({ grant, familyId: 'fam-1' });
      expect('planToken' in opts).toBe(false);
    });

    it('canRequestManagedRead follows isReadOnly', () => {
      const { canRequestManagedRead } = useAiCapability();
      expect(canRequestManagedRead.value).toBe(true);
      h.entitlement.isReadOnly = true;
      expect(useAiCapability().canRequestManagedRead.value).toBe(false);
    });

    it('refuses a managed read while read-only, with the read-only toast', () => {
      h.entitlement.isReadOnly = true;
      expect(useAiCapability().refuseManagedReadIfReadOnly()).toBe(true);
      expect(h.showToast).toHaveBeenCalledWith(
        'info',
        'readOnly.toast.title',
        'readOnly.toast.message'
      );
      expect(h.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ context: { action: 'read_only_refused' } })
      );
    });

    it('lets a managed read through when writable', () => {
      expect(useAiCapability().refuseManagedReadIfReadOnly()).toBe(false);
      expect(h.showToast).not.toHaveBeenCalled();
    });

    it('never refuses BYOK or on-device: those never reach our proxy', () => {
      h.entitlement.isReadOnly = true;
      storeState.aiTier = 'byok';
      expect(useAiCapability().refuseManagedReadIfReadOnly()).toBe(false);
      storeState.aiTier = 'on-device';
      expect(useAiCapability().refuseManagedReadIfReadOnly()).toBe(false);
      expect(h.showToast).not.toHaveBeenCalled();
    });
  });
});
