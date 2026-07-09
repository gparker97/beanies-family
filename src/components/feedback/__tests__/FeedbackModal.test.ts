import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';

// Shared, test-controllable open state (mirrors the module singleton).
const isOpen = ref(false);
const closeMock = vi.fn(() => {
  isOpen.value = false;
});
const submitMock = vi.fn();
const recordMock = vi.fn();
const openDiscordMock = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useFeedbackModal', () => ({
  useFeedbackModal: () => ({ isOpen, close: closeMock, openFeedback: vi.fn() }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ recordFeedbackPrompted: recordMock }),
}));
vi.mock('@/utils/feedbackSubmit', () => ({
  submitFeedback: (...a: unknown[]) => submitMock(...a),
}));
vi.mock('@/utils/discord', () => ({
  openDiscord: (...a: unknown[]) => openDiscordMock(...a),
}));

import FeedbackModal from '@/components/feedback/FeedbackModal.vue';

const BeanieFormModalStub = {
  props: ['open', 'saveDisabled'],
  emits: ['save', 'close'],
  template: `<div v-if="open" class="form-modal">
    <slot />
    <button class="do-save" :disabled="saveDisabled" @click="$emit('save')">save</button>
    <button class="do-close" @click="$emit('close')">x</button>
  </div>`,
};
const BaseModalStub = {
  props: ['open'],
  emits: ['close'],
  template: `<div v-if="open" class="thanks-modal"><slot /></div>`,
};
const NpsScaleStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `<button class="pick" @click="$emit('update:modelValue', 9)">pick</button>`,
};

function mountModal() {
  return mount(FeedbackModal, {
    global: {
      stubs: {
        BeanieFormModal: BeanieFormModalStub,
        BaseModal: BaseModalStub,
        NpsScale: NpsScaleStub,
        BaseTextarea: true,
        BaseInput: true,
        ConditionalSection: true,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isOpen.value = false;
});

describe('FeedbackModal', () => {
  it('disables save until a score is picked, then submits + records + shows thanks', async () => {
    const w = mountModal();
    isOpen.value = true;
    await nextTick();

    expect(w.find('.form-modal').exists()).toBe(true);
    expect(w.find('.do-save').attributes('disabled')).toBeDefined();

    await w.find('.pick').trigger('click'); // score → 9
    expect(w.find('.do-save').attributes('disabled')).toBeUndefined();

    await w.find('.do-save').trigger('click');
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0][0]).toMatchObject({ score: 9 });
    expect(recordMock).toHaveBeenCalledTimes(1);

    // Switched to the thank-you view.
    expect(w.find('.thanks-modal').exists()).toBe(true);
    expect(w.find('.form-modal').exists()).toBe(false);
  });

  it('the Discord CTA opens Discord with the feedback surface and closes', async () => {
    const w = mountModal();
    isOpen.value = true;
    await nextTick();
    await w.find('.pick').trigger('click');
    await w.find('.do-save').trigger('click');

    const discordBtn = w.find('.thanks-modal button');
    await discordBtn.trigger('click');
    expect(openDiscordMock).toHaveBeenCalledWith('feedback');
    expect(closeMock).toHaveBeenCalled();
  });

  it('resets to the form view on reopen', async () => {
    const w = mountModal();
    isOpen.value = true;
    await nextTick();
    await w.find('.pick').trigger('click');
    await w.find('.do-save').trigger('click');
    expect(w.find('.thanks-modal').exists()).toBe(true);

    // Close, then reopen → back to a fresh form (onNew reset).
    isOpen.value = false;
    await nextTick();
    isOpen.value = true;
    await nextTick();
    expect(w.find('.form-modal').exists()).toBe(true);
    expect(w.find('.do-save').attributes('disabled')).toBeDefined();
  });
});
