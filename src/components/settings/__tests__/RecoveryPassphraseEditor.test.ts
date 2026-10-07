/**
 * RecoveryPassphraseEditor: async suggestion, debounced live check with a 5-segment meter,
 * Save gated on an `ok` verdict, and the legacy-passphrase nudge. The strength module is
 * mocked so no EFF or zxcvbn chunk loads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  generatePassphrase: vi.fn(async () => 'one-two-three-four-five-six'),
  checkFamilyPassphrase: vi.fn(),
  setRecoveryPassphrase: vi.fn(),
}));

vi.mock('@/utils/passphraseStrength', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/passphraseStrength')>()),
  generatePassphrase: h.generatePassphrase,
}));
// The family-aware verdict (userInputs, telemetry) lives in the store and is tested there
// (`authStore.kdfUpgrade.test.ts`); the editor only calls it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    checkFamilyPassphrase: h.checkFamilyPassphrase,
    setRecoveryPassphrase: h.setRecoveryPassphrase,
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import RecoveryPassphraseEditor from '@/components/settings/RecoveryPassphraseEditor.vue';

const stubs = {
  BaseButton: {
    props: ['disabled'],
    template: '<button :disabled="disabled" v-bind="$attrs"><slot /></button>',
  },
  BaseInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input data-testid="own" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};

function mountEditor(props = { hasPassphrase: false, legacyPending: false }) {
  return mount(RecoveryPassphraseEditor, { props, global: { stubs } });
}

async function open(w: ReturnType<typeof mountEditor>) {
  await w.find('button').trigger('click');
  await flushPromises();
}

async function typeOwn(w: ReturnType<typeof mountEditor>, text: string) {
  const buttons = w.findAll('button');
  await buttons.find((b) => b.text() === 'recovery.passphraseUseOwn')!.trigger('click');
  await w.find('[data-testid="own"]').setValue(text);
  await vi.advanceTimersByTimeAsync(150);
  await flushPromises();
}

const saveButton = (w: ReturnType<typeof mountEditor>) =>
  w.findAll('button').find((b) => b.text() === 'action.save')!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  h.generatePassphrase.mockResolvedValue('one-two-three-four-five-six');
  h.setRecoveryPassphrase.mockResolvedValue({ success: true });
});
afterEach(() => vi.useRealTimers());

describe('RecoveryPassphraseEditor', () => {
  it('shows the loading text while the suggestion is generated, then the phrase', async () => {
    let release: (v: string) => void = () => {};
    h.generatePassphrase.mockReturnValue(new Promise((r) => (release = r)));
    const w = mountEditor();
    await w.find('button').trigger('click');
    expect(w.find('[data-testid="passphrase-suggestion"]').text()).toBe('action.loading');
    expect(saveButton(w).attributes('disabled')).toBeDefined();
    release('alpha-beta-gamma-delta-epsilon-zeta');
    await flushPromises();
    expect(w.find('[data-testid="passphrase-suggestion"]').text()).toBe(
      'alpha-beta-gamma-delta-epsilon-zeta'
    );
    expect(saveButton(w).attributes('disabled')).toBeUndefined();
  });

  it('saves the suggestion and emits saved', async () => {
    const w = mountEditor();
    await open(w);
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(h.setRecoveryPassphrase).toHaveBeenCalledWith('one-two-three-four-five-six');
    expect(w.emitted('saved')).toHaveLength(1);
  });

  it("checks a typed phrase after 150 ms through the store's family-aware check", async () => {
    h.checkFamilyPassphrase.mockResolvedValue({ ok: false, reason: 'too-guessable', score: 1 });
    const w = mountEditor();
    await open(w);
    const buttons = w.findAll('button');
    await buttons.find((b) => b.text() === 'recovery.passphraseUseOwn')!.trigger('click');
    await w.find('[data-testid="own"]').setValue('i love my kids 1');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.checkFamilyPassphrase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    await flushPromises();
    expect(h.checkFamilyPassphrase).toHaveBeenCalledTimes(1);
    expect(h.checkFamilyPassphrase).toHaveBeenCalledWith('i love my kids 1');
  });

  it('a weak verdict fills the meter, explains why and keeps Save disabled', async () => {
    h.checkFamilyPassphrase.mockResolvedValue({
      ok: false,
      reason: 'too-guessable',
      score: 1,
      hintKey: 'recovery.strengthHint.commonWord',
    });
    const w = mountEditor();
    await open(w);
    await typeOwn(w, 'i love my kids 1');
    const meter = w.find('[role="meter"]');
    expect(meter.attributes('aria-valuemin')).toBe('0');
    expect(meter.attributes('aria-valuemax')).toBe('4');
    expect(meter.attributes('aria-valuenow')).toBe('1');
    expect(meter.findAll('span.from-\\[\\#F15D22\\]')).toHaveLength(2);
    expect(w.find('[data-testid="strength-label"]').text()).toBe('recovery.strengthWeak');
    expect(w.text()).toContain('recovery.passphraseTooGuessable');
    expect(w.text()).toContain('recovery.strengthHint.commonWord');
    expect(saveButton(w).attributes('disabled')).toBeDefined();
  });

  it('an ok verdict shows a full Strong meter and enables Save, which saves the typed phrase', async () => {
    h.checkFamilyPassphrase.mockResolvedValue({ ok: true, score: 4 });
    const w = mountEditor();
    await open(w);
    await typeOwn(w, 'purple monkey dishwasher sunrise');
    expect(w.find('[role="meter"]').attributes('aria-valuenow')).toBe('4');
    expect(w.find('[data-testid="strength-label"]').text()).toBe('recovery.strengthStrong');
    expect(saveButton(w).attributes('disabled')).toBeUndefined();
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(h.setRecoveryPassphrase).toHaveBeenCalledWith('purple monkey dishwasher sunrise');
  });

  it('says so when the check is unavailable and never enables Save', async () => {
    h.checkFamilyPassphrase.mockResolvedValue({
      ok: false,
      reason: 'scorer-unavailable',
      score: 0,
    });
    const w = mountEditor();
    await open(w);
    await typeOwn(w, 'purple monkey dishwasher sunrise');
    expect(w.text()).toContain('recovery.passphraseCheckUnavailable');
    expect(saveButton(w).attributes('disabled')).toBeDefined();
  });

  it('shows the legacy nudge only while legacyPending', () => {
    expect(
      mountEditor({ hasPassphrase: true, legacyPending: true })
        .find('[data-testid="inferred-hint"]')
        .text()
    ).toBe('recovery.passphraseLegacyNudge');
    expect(
      mountEditor({ hasPassphrase: true, legacyPending: false })
        .find('[data-testid="inferred-hint"]')
        .exists()
    ).toBe(false);
  });

  it('surfaces a store failure without closing the editor', async () => {
    h.setRecoveryPassphrase.mockResolvedValue({ success: false, error: 'nope' });
    const w = mountEditor();
    await open(w);
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe('nope');
    expect(w.emitted('saved')).toBeUndefined();
  });
});
