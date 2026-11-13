/**
 * Copy a bean's chores (mirrors `ListCopyModal`): the source's blocks with their counts, the
 * other beans to copy to, one `copyChores` write with the chosen blocks, a toast that counts
 * skipped duplicates, and a double-tap that cannot fire two batches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({ showToast: toast }));

import ChoreCopyModal from '../ChoreCopyModal.vue';
import { chore, choreActions, chores, resetKit } from './choreTestKit';

const ChipPickerStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] }, members: Array, mode: String },
  emits: ['update:modelValue'],
  template: '<div />',
});

const stubs = {
  BeanieFormModal: {
    props: ['open', 'title', 'saveLabel', 'saveDisabled', 'isSubmitting'],
    template:
      '<div v-if="open"><h2 data-testid="title">{{ title }}</h2><button data-testid="save" :disabled="saveDisabled || isSubmitting" @click="$emit(\'save\')">{{ saveLabel }}</button><slot /></div>',
  },
  FormFieldGroup: { template: '<div><slot /></div>' },
  FamilyChipPicker: ChipPickerStub,
};

async function openModal(): Promise<VueWrapper> {
  const w = mount(ChoreCopyModal, {
    props: { open: false, sourceMemberId: 'kid' },
    global: { stubs },
  });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

const pick = async (w: VueWrapper, ids: string[]) => {
  w.findComponent(ChipPickerStub).vm.$emit('update:modelValue', ids);
  await flushPromises();
};

beforeEach(() => {
  resetKit();
  toast.mockReset();
  chores.list = [
    chore('m1'),
    chore('m2'),
    chore('e1', { block: 'evening' }),
    chore('s1', { assigneeIds: ['sib'] }),
  ];
  choreActions.copyChores.mockResolvedValue({ added: 2, skipped: 1 });
});

describe('ChoreCopyModal', () => {
  it('lists the source’s blocks with counts, all ticked, and offers everyone else', async () => {
    const w = await openModal();
    const rows = w.findAll('[data-testid="chore-copy-block"]');
    expect(rows.map((r) => r.attributes('data-block'))).toEqual(['morning', 'evening']);
    expect(rows.every((r) => (r.get('input').element as HTMLInputElement).checked)).toBe(true);
    const offered = (w.findComponent(ChipPickerStub).props('members') as { id: string }[]).map(
      (m) => m.id
    );
    expect(offered).toEqual(['mom', 'dad', 'sib']);
  });

  it('is unavailable until someone is chosen, then copies the chosen blocks in ONE write', async () => {
    const w = await openModal();
    expect(w.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
    await pick(w, ['sib']);
    expect(w.get('[data-testid="save"]').text()).toBe('choreboard.copy.save.other');
    // Untick Evening: one chore fewer.
    await w.get('[data-block="evening"] input').trigger('change');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(choreActions.copyChores).toHaveBeenCalledTimes(1);
    expect(choreActions.copyChores).toHaveBeenCalledWith('kid', ['sib'], ['morning'], 'mom');
    expect(toast).toHaveBeenCalledWith(
      'success',
      'choreboard.copy.done.other',
      'choreboard.batch.skipped.one'
    );
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('a double-tap fires one batch', async () => {
    let resolve!: (v: unknown) => void;
    choreActions.copyChores.mockReturnValue(new Promise((r) => (resolve = r)));
    const w = await openModal();
    await pick(w, ['sib']);
    const save = w.get('[data-testid="save"]');
    await save.trigger('click');
    await save.trigger('click');
    resolve({ added: 3, skipped: 0 });
    await flushPromises();
    expect(choreActions.copyChores).toHaveBeenCalledTimes(1);
  });

  it('a store null stays open and is not toasted again', async () => {
    choreActions.copyChores.mockResolvedValue(null);
    const w = await openModal();
    await pick(w, ['sib']);
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('re-opens fresh: the previous selection does not carry over', async () => {
    const w = await openModal();
    await pick(w, ['sib']);
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await flushPromises();
    expect(w.findComponent(ChipPickerStub).props('modelValue')).toEqual([]);
  });
});
