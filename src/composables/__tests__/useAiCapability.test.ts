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

import { useAiCapability } from '../useAiCapability';

beforeEach(() => {
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
});
