import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the settings store so we control aiProvider + aiApiKeys without Pinia.
const storeState = {
  aiProvider: 'none' as 'none' | 'openai' | 'claude' | 'gemini',
  settings: { aiApiKeys: {} as Record<string, string | undefined> },
};
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => storeState,
}));

import { useAiCapability } from '../useAiCapability';

beforeEach(() => {
  storeState.aiProvider = 'none';
  storeState.settings.aiApiKeys = {};
});

describe('useAiCapability', () => {
  it('defaults to the managed tier when no BYOK provider is configured', () => {
    const { tier, byokConfig, isConfigured } = useAiCapability();
    expect(tier.value).toBe('managed');
    expect(byokConfig.value).toBeNull();
    expect(isConfigured.value).toBe(true); // managed is always selectable
  });

  it('selects BYOK when a provider AND a matching key are set', () => {
    storeState.aiProvider = 'openai';
    storeState.settings.aiApiKeys = { openai: 'sk-test' };

    const { tier, byokConfig } = useAiCapability();
    expect(tier.value).toBe('byok');
    expect(byokConfig.value).toEqual({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('falls back to managed when a provider is set but its key is missing', () => {
    storeState.aiProvider = 'gemini';
    storeState.settings.aiApiKeys = {}; // no gemini key

    const { tier, byokConfig } = useAiCapability();
    expect(tier.value).toBe('managed');
    expect(byokConfig.value).toBeNull();
  });

  it('reads the key for the selected provider, not another', () => {
    storeState.aiProvider = 'claude';
    storeState.settings.aiApiKeys = { openai: 'sk-openai' }; // wrong provider's key

    const { byokConfig } = useAiCapability();
    expect(byokConfig.value).toBeNull();
  });
});
