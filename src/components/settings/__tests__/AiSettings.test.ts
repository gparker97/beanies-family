import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AiSettings from '../AiSettings.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { BaseButton } from '@/components/ui';
import { showToast } from '@/composables/useToast';
import { validateByokKey } from '@/services/ai/providers/validateByokKey';

// Mutable store mock — set fields per test, then mount fresh (computed read current values).
const store = {
  aiTier: 'managed' as 'managed' | 'byok' | 'on-device',
  aiProvider: 'none' as 'none' | 'openai' | 'claude' | 'gemini',
  settings: { aiApiKeys: {} as Record<string, string | undefined> },
  skipDocumentConsentPrompt: false,
  error: null as string | null,
  setAITier: vi.fn(),
  setAIProvider: vi.fn(),
  setAIApiKey: vi.fn(),
  setSkipDocumentConsentPrompt: vi.fn(),
};
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => store }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/ai/providers/validateByokKey', () => ({ validateByokKey: vi.fn() }));

// Stub the modal shell so the test focuses on AiSettings' own logic, not the drawer chrome.
function mountAi() {
  return mount(AiSettings, {
    props: { open: true },
    global: {
      stubs: { BeanieFormModal: { template: '<div><slot /></div>' } },
    },
  });
}

beforeEach(() => {
  store.aiTier = 'managed';
  store.aiProvider = 'none';
  store.settings.aiApiKeys = {};
  store.skipDocumentConsentPrompt = false;
  store.error = null;
  vi.clearAllMocks();
});

describe('AiSettings', () => {
  it('managed tier: no BYOK key field, privacy copy reflects the managed tier', () => {
    const wrapper = mountAi();
    expect(wrapper.findComponent(BaseInput).exists()).toBe(false);
    expect(wrapper.text()).toContain('settings.ai.privacy.managed');
  });

  it('on-device option is rendered but disabled (coming soon)', () => {
    const wrapper = mountAi();
    const onDevice = wrapper.find('option[value="on-device"]');
    expect(onDevice.exists()).toBe(true);
    expect(onDevice.attributes('disabled')).toBeDefined();
  });

  it('byok tier reveals the provider select + key field', () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    const wrapper = mountAi();
    expect(wrapper.findComponent(BaseInput).exists()).toBe(true);
    expect(wrapper.text()).toContain('settings.ai.privacy.byok');
  });

  it('test-key button is hidden when no key is entered', () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    store.settings.aiApiKeys = {}; // no key
    const wrapper = mountAi();
    expect(wrapper.findComponent(BaseButton).exists()).toBe(false);
  });

  it('test-key button shows when openai + a stored key is present', () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    store.settings.aiApiKeys = { openai: 'sk-test' };
    const wrapper = mountAi();
    expect(wrapper.findComponent(BaseButton).exists()).toBe(true);
  });

  it('the relocated consent toggle is present and reflects skipDocumentConsentPrompt', () => {
    store.skipDocumentConsentPrompt = false; // ON = ask
    const wrapper = mountAi();
    expect(wrapper.find('[data-testid="ai-consent-toggle"]').exists()).toBe(true);
  });

  it('#1 picking BYOK while provider is "none" defaults the provider to openai (no silent no-op)', async () => {
    store.aiTier = 'managed';
    store.aiProvider = 'none';
    const wrapper = mountAi();
    // Only the tier select renders on the managed tier.
    await wrapper.findComponent(BaseSelect).vm.$emit('update:modelValue', 'byok');
    await flushPromises();
    expect(store.setAITier).toHaveBeenCalledWith('byok');
    expect(store.setAIProvider).toHaveBeenCalledWith('openai');
  });

  it('#3 onSaveKey skips the write when the key is unchanged', async () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    store.settings.aiApiKeys = { openai: 'sk-test' }; // keyDraft seeds to this
    const wrapper = mountAi();
    await wrapper.findComponent(BaseInput).vm.$emit('blur'); // blur with the unchanged value
    await flushPromises();
    expect(store.setAIApiKey).not.toHaveBeenCalled();
  });

  it('#3 onSaveKey persists when the key actually changed', async () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    store.settings.aiApiKeys = { openai: 'sk-test' };
    const wrapper = mountAi();
    const input = wrapper.findComponent(BaseInput);
    await input.vm.$emit('update:modelValue', 'sk-new');
    await input.vm.$emit('blur');
    await flushPromises();
    expect(store.setAIApiKey).toHaveBeenCalledWith('openai', 'sk-new');
  });

  it('a rejected test key shows a SILENT error toast (no Slack report / no "support notified")', async () => {
    store.aiTier = 'byok';
    store.aiProvider = 'openai';
    store.settings.aiApiKeys = { openai: 'sk-bad' };
    vi.mocked(validateByokKey).mockResolvedValue({ ok: false, reason: 'invalid_key' });
    const wrapper = mountAi();
    await wrapper.findComponent(BaseButton).trigger('click');
    await flushPromises();
    // The 4th arg `{ silent: true }` suppresses reportError + the "support has been notified" line.
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'settings.ai.test.invalid.title',
      'settings.ai.test.invalid.message',
      { silent: true }
    );
  });
});
