/**
 * The edit form (new chores are added in the Add Chores sheet): a title and at least one person
 * are required (Save stays tappable and nothing is written); the days shortcuts store the right
 * weekdays; edit seeds the chore and sends only what changed; a chore deleted elsewhere is never
 * re-created; Keep Parents Posted appears only for a children-only chore; the picture is last and
 * folded; delete goes through the confirm tier, with "only for this bean" for a shared chore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
vi.mock(
  '@/composables/useChoreClock',
  async () => (await import('./choreTestKit')).choreClockModule
);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({ showToast: toast }));
const confirmFn = vi.hoisted(() => vi.fn());
const confirmChoiceFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({
  confirm: confirmFn,
  confirmChoice: confirmChoiceFn,
}));
const whoosh = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useSounds', () => ({ useSounds: () => ({ playWhoosh: whoosh }) }));

import ChoreFormModal from '../ChoreFormModal.vue';
import { chore, choreActions, chores, resetKit } from './choreTestKit';

const PeopleStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] }, hintTestid: String },
  emits: ['update:modelValue'],
  template: '<div data-testid="people"><slot name="hint" /></div>',
});
const DaysStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  template: '<div data-testid="days-stub" />',
});

const stubs = {
  BeanieFormModal: {
    props: ['open', 'title', 'saveLabel', 'showDelete', 'saveReady'],
    emits: ['save', 'delete', 'close'],
    template: `<div v-if="open">
      <h2 data-testid="title">{{ title }}</h2>
      <slot />
      <button data-testid="save" :data-ready="String(saveReady)" @click="$emit('save')">{{ saveLabel }}</button>
      <button v-if="showDelete" data-testid="delete" @click="$emit('delete')" />
    </div>`,
  },
  FormFieldGroup: { props: ['label'], template: '<div><slot /></div>' },
  BaseInput: {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  ListPeoplePicker: PeopleStub,
  DayOfWeekSelector: DaysStub,
  EmojiPicker: { props: ['modelValue', 'options'], template: '<div />' },
  CardArt: true,
  NotifyParentsToggle: {
    props: ['modelValue', 'testid'],
    template: '<div data-testid="notify-parents" />',
  },
};

let wrapper: VueWrapper | null = null;

async function openForm(props: Record<string, unknown> = {}) {
  wrapper = mount(ChoreFormModal, {
    props: { open: false, ...props },
    global: { stubs },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

async function typeTitle(w: VueWrapper, value: string) {
  await w.get('[data-testid="chore-form-title"]').setValue(value);
}
async function pickPeople(w: VueWrapper, ids: string[]) {
  w.findComponent(PeopleStub).vm.$emit('update:modelValue', ids);
  await flushPromises();
}
async function save(w: VueWrapper) {
  await w.get('[data-testid="save"]').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  // `useFormValidation` reads the translation store for its "still needed" toast.
  setActivePinia(createPinia());
  resetKit();
  toast.mockReset();
  confirmFn.mockReset();
  confirmChoiceFn.mockReset();
  whoosh.mockReset();
  choreActions.updateChore.mockImplementation(async (id, patch) => ({ ...chore(id), ...patch }));
  chores.list = [
    chore('c1', {
      title: 'Feed the dog',
      emoji: '🐶',
      assigneeIds: ['kid', 'sib'],
      block: 'morning',
      days: [1, 2, 3, 4, 5],
    }),
    chore('solo', { title: 'Brush teeth', assigneeIds: ['kid'], block: 'morning' }),
  ];
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('ChoreFormModal: required fields', () => {
  it('writes nothing without a title, or without anyone, and never disables Save', async () => {
    const w = await openForm({ choreId: 'solo' });
    expect(w.get('[data-testid="title"]').text()).toBe('choreboard.form.titleEdit');
    await typeTitle(w, '   ');
    expect(w.get('[data-testid="save"]').attributes('data-ready')).toBe('false');
    await save(w);
    expect(choreActions.updateChore).not.toHaveBeenCalled();

    await typeTitle(w, 'Feed the fish');
    await pickPeople(w, ['ghost']); // a removed member alone does not count as someone
    await save(w);
    expect(choreActions.updateChore).not.toHaveBeenCalled();

    await pickPeople(w, ['kid']);
    expect(w.get('[data-testid="save"]').attributes('data-ready')).toBe('true');
    await save(w);
    expect(choreActions.updateChore).toHaveBeenCalledWith(
      'solo',
      { title: 'Feed the fish' },
      'mom'
    );
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('a failed or refused save (null) of a chore that still exists stays open', async () => {
    choreActions.updateChore.mockResolvedValue(null);
    const w = await openForm({ choreId: 'solo' });
    await typeTitle(w, 'Feed the fish');
    await save(w);
    expect(choreActions.updateChore).toHaveBeenCalledTimes(1);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('a chore deleted on another device is never re-created: the store refuses, the form closes', async () => {
    // The real store answers a gone chore with its `not-found` refusal (toast) and `null`.
    choreActions.updateChore.mockResolvedValue(null);
    const w = await openForm({ choreId: 'solo' });
    await typeTitle(w, 'Feed the fish');
    chores.list = chores.list.filter((c) => c.id !== 'solo');
    await flushPromises();
    await save(w);
    expect(choreActions.createChore).not.toHaveBeenCalled();
    expect(choreActions.updateChore).toHaveBeenCalledWith(
      'solo',
      expect.objectContaining({ title: 'Feed the fish' }),
      'mom'
    );
    expect(w.emitted('close')).toHaveLength(1);
    expect(w.emitted('saved')).toBeUndefined();
  });
});

describe('ChoreFormModal: days shortcuts', () => {
  async function saveWithMode(mode: string) {
    const w = await openForm({ choreId: 'solo' });
    await w.get(`[data-mode="${mode}"] button`).trigger('click');
    await save(w);
    return w;
  }

  it('Every Day hides the day chips; choosing it stores no days', async () => {
    const w = await openForm({ choreId: 'c1' });
    await w.get('[data-mode="every"] button').trigger('click');
    expect(w.find('[data-testid="chore-form-days"]').exists()).toBe(false);
    await save(w);
    expect(choreActions.updateChore.mock.calls[0]![1].days).toEqual([]);
  });

  it('School Days is Monday to Friday', async () => {
    const w = await saveWithMode('school');
    expect(w.findComponent(DaysStub).props('modelValue')).toEqual([1, 2, 3, 4, 5]);
    expect(choreActions.updateChore.mock.calls[0]![1].days).toEqual([1, 2, 3, 4, 5]);
  });

  it('Weekends is Saturday and Sunday', async () => {
    await saveWithMode('weekends');
    expect(choreActions.updateChore.mock.calls[0]![1].days).toEqual([0, 6]);
  });

  it('Pick Days needs at least one day, then stores the picked days', async () => {
    const w = await saveWithMode('pick');
    expect(choreActions.updateChore).not.toHaveBeenCalled();
    w.findComponent(DaysStub).vm.$emit('update:modelValue', [3]);
    await flushPromises();
    await save(w);
    expect(choreActions.updateChore.mock.calls[0]![1].days).toEqual([3]);
  });

  it('adjusting a preset’s chips switches to Pick Days', async () => {
    const w = await openForm({ choreId: 'solo' });
    await w.get('[data-mode="school"] button').trigger('click');
    w.findComponent(DaysStub).vm.$emit('update:modelValue', [1, 2, 3]);
    await flushPromises();
    expect(w.get('[data-mode="pick"] button').attributes('aria-pressed')).toBe('true');
  });
});

describe('ChoreFormModal: edit', () => {
  it('seeds the chore and sends only what changed', async () => {
    const w = await openForm({ choreId: 'c1' });
    expect(w.get('[data-testid="title"]').text()).toBe('choreboard.form.titleEdit');
    expect(w.get('[data-testid="save"]').text()).toBe('choreboard.form.saveEdit');
    expect(w.findComponent(PeopleStub).props('modelValue')).toEqual(['kid', 'sib']);
    expect(w.get('[data-mode="school"] button').attributes('aria-pressed')).toBe('true');
    expect(w.find('[data-testid="chore-form-shared-hint"]').exists()).toBe(true);

    await w.get('[data-block="evening"]').trigger('click');
    await save(w);
    expect(choreActions.updateChore).toHaveBeenCalledWith('c1', { block: 'evening' }, 'mom');
    expect(choreActions.createChore).not.toHaveBeenCalled();
  });

  it('a remote edit made while the form is open is never written back to its old value', async () => {
    const w = await openForm({ choreId: 'c1' });
    // Another device moves the chore to the evening and renames nothing.
    chores.list = chores.list.map((c) => (c.id === 'c1' ? { ...c, block: 'evening' } : c));
    await flushPromises();
    await typeTitle(w, 'Brush teeth well');
    await save(w);
    // Before the fix the form diffed against the LIVE chore: its seeded `morning` differed
    // from the remote `evening`, so the save sent `block: 'morning'` and undid the move.
    expect(choreActions.updateChore).toHaveBeenCalledWith(
      'c1',
      { title: 'Brush teeth well' },
      'mom'
    );
  });

  it('nothing changed: closes without a write', async () => {
    const w = await openForm({ choreId: 'c1' });
    await save(w);
    expect(choreActions.updateChore).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);
  });
});

describe('ChoreFormModal: the picture', () => {
  it('sits last, folded behind Change Picture; the preview by the name stays', async () => {
    const w = await openForm({ choreId: 'c1' });
    expect(w.find('[data-testid="chore-form-preview"]').exists()).toBe(true);
    const toggle = w.get('[data-testid="chore-form-picture-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(w.find('[data-testid="chore-picture-picker"]').exists()).toBe(false);
    // Nothing about the picture comes before the name, who, time of day or days.
    const html = w.html();
    for (const id of ['chore-form-title', 'chore-form-blocks', 'chore-form-days-modes']) {
      expect(html.indexOf(`data-testid="${id}"`)).toBeLessThan(
        html.indexOf('data-testid="chore-form-picture"')
      );
    }
    await toggle.trigger('click');
    expect(w.find('[data-testid="chore-picture-picker"]').exists()).toBe(true);
  });

  it('opens folded again, and an edit never changes the picture by itself', async () => {
    const w = await openForm({ choreId: 'c1' });
    await w.get('[data-testid="chore-form-picture-toggle"]').trigger('click');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await flushPromises();
    expect(w.find('[data-testid="chore-picture-picker"]').exists()).toBe(false);
    await typeTitle(w, 'Brush teeth'); // a title that would suggest 🪥
    await save(w);
    expect(choreActions.updateChore).toHaveBeenCalledWith('c1', { title: 'Brush teeth' }, 'mom');
  });
});

describe('ChoreFormModal: delete', () => {
  it('asks first (danger), then deletes and closes', async () => {
    confirmFn.mockResolvedValueOnce(false);
    choreActions.deleteChore.mockResolvedValue(true);
    const w = await openForm({ choreId: 'solo' });
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger', detail: undefined })
    );
    expect(choreActions.deleteChore).not.toHaveBeenCalled();

    confirmFn.mockResolvedValueOnce(true);
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(choreActions.deleteChore).toHaveBeenCalledWith('solo', 'mom');
    expect(whoosh).toHaveBeenCalled();
    expect(w.emitted('deleted')).toHaveLength(1);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('a shared chore opened without a bean says who it comes off the board for', async () => {
    confirmFn.mockResolvedValueOnce(true);
    choreActions.deleteChore.mockResolvedValue(true);
    const w = await openForm({ choreId: 'c1' });
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(confirmFn.mock.calls[0]![0].detail).toBe('choreboard.form.deleteConfirm.who');
    expect(choreActions.deleteChore).toHaveBeenCalledWith('c1', 'mom');
  });

  it('a shared chore opened from a bean offers "only for them" (the default) or everyone', async () => {
    choreActions.removeChoresForMember.mockResolvedValue({ deleted: 0, unassigned: 1 });
    choreActions.deleteChore.mockResolvedValue(true);
    confirmChoiceFn.mockResolvedValueOnce('bean');
    const w = await openForm({ choreId: 'c1', beanId: 'kid' });
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    const opts = confirmChoiceFn.mock.calls[0]![0];
    expect(opts).toMatchObject({ variant: 'danger', defaultChoice: 'bean' });
    expect(opts.choices.map((c: { id: string }) => c.id)).toEqual(['bean', 'all']);
    expect(choreActions.removeChoresForMember).toHaveBeenCalledWith(['c1'], 'kid', 'mom');
    expect(choreActions.deleteChore).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);

    confirmChoiceFn.mockResolvedValueOnce('all');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await flushPromises();
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(choreActions.deleteChore).toHaveBeenCalledWith('c1', 'mom');

    confirmChoiceFn.mockResolvedValueOnce(null); // cancelled
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(choreActions.deleteChore).toHaveBeenCalledTimes(1);
  });
});

describe('ChoreFormModal: Keep Parents Posted', () => {
  it('shows only for a chore that is for children only', async () => {
    const w = await openForm({ choreId: 'c1' });
    expect(w.find('[data-testid="notify-parents"]').exists()).toBe(true);
    await pickPeople(w, ['kid', 'dad']);
    expect(w.find('[data-testid="notify-parents"]').exists()).toBe(false);
  });
});
