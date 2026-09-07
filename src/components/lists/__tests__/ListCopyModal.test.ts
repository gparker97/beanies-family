/**
 * The modal's own contract: what it disables, what it says, when it closes, and — the
 * one that actually bites — that a double-tap cannot fire two batches. The write being
 * atomic prevents a partial batch, not a duplicate submission.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import type { FamilyList } from '@/types/models';

const copyFn = vi.hoisted(() => vi.fn());
const storeLists = vi.hoisted(() => ({ value: [] as FamilyList[] }));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    get lists() {
      return storeLists.value;
    },
    copyListForMembers: copyFn,
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/composables/useToast', () => ({ showToast: toast.fn }));

import ListCopyModal from '../ListCopyModal.vue';

const SOURCE: FamilyList = {
  id: 'l-1',
  title: 'Saturday Chores',
  emoji: '🧹',
  category: 'kids',
  ownerId: 'm-joey',
  items: [{ id: 'i-1', title: 'Make the bed', completed: false }],
  lifecycle: 'oneoff',
  completed: false,
  createdBy: 'm-greg',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** Held as a value so `findComponent` can locate it by reference, not by name. */
const ChipPickerStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  template: '<div />',
});

const stubs = {
  BeanieFormModal: {
    props: ['open', 'saveLabel', 'saveDisabled', 'isSubmitting'],
    template:
      '<div><button data-testid="save" :disabled="saveDisabled || isSubmitting" @click="$emit(\'save\')">{{ saveLabel }}</button><slot /></div>',
  },
  BaseInput: { props: ['modelValue'], template: '<input :value="modelValue" />' },
  FormFieldGroup: { template: '<div><slot /></div>' },
  FamilyChipPicker: ChipPickerStub,
};

/** Mount CLOSED then open, because `useFormModal`'s reset watcher is not `immediate`. */
async function openModal() {
  const wrapper = mount(ListCopyModal, {
    props: { open: false, sourceId: 'l-1' },
    global: { stubs },
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

const pickBeans = (wrapper: Awaited<ReturnType<typeof openModal>>, ids: string[]) =>
  wrapper.findComponent(ChipPickerStub).vm.$emit('update:modelValue', ids);

beforeEach(() => {
  setActivePinia(createPinia());
  storeLists.value = [SOURCE];
  vi.clearAllMocks();
  copyFn.mockResolvedValue([SOURCE]);
});

describe('ListCopyModal', () => {
  it('seeds the title from the source but leaves {bean} for the per-copy expansion', async () => {
    const wrapper = await openModal();
    expect(wrapper.find('input').attributes('value')).toBe('lists.copy.titleDefault');
  });

  it('disables save until at least one bean is chosen', async () => {
    const wrapper = await openModal();
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
  });

  it('says "Create Copy" for one bean and the plural key for more', async () => {
    const wrapper = await openModal();
    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').text()).toBe('lists.copy.createOne');

    await pickBeans(wrapper, ['m-joey', 'm-ollie']);
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').text()).toBe('lists.copy.createOther');
  });

  it('closes on success', async () => {
    const wrapper = await openModal();
    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('stays open when the store returns a falsy result, and does not toast again', async () => {
    // The store already toasted and reported; a second toast here would page Slack twice.
    copyFn.mockResolvedValue(null);
    const wrapper = await openModal();
    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close')).toBeUndefined();
    expect(toast.fn).not.toHaveBeenCalled();
  });

  it('fires exactly one copy for a double-tap on save', async () => {
    let release!: (v: FamilyList[]) => void;
    copyFn.mockReturnValue(new Promise((r) => (release = r)));
    const wrapper = await openModal();
    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();

    const save = wrapper.get('[data-testid="save"]');
    await save.trigger('click');
    await save.trigger('click');

    expect(copyFn).toHaveBeenCalledTimes(1);
    release([SOURCE]);
    await flushPromises();
  });

  it('resets the selection when reopened', async () => {
    const wrapper = await openModal();
    await pickBeans(wrapper, ['m-joey']);
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    // Stale selection surviving a reopen is exactly what a non-immediate watch on a
    // `v-if`-gated modal would have caused.
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
  });
});
