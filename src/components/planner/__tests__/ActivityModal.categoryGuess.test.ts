/**
 * The category guess wired into the real activity drawer (#152): the title picks the category,
 * the icon follows and is cleared with it, a hand pick sticks, an occasion is shown but only
 * written on commit, the reused drawer never carries a guess into an edit, Change reaches the
 * picker, and one `category-guess` event is logged per new-activity save.
 *
 * The matcher is faked so this pins the form's wiring, not the keyword lists (those have their
 * own tests): the rule itself is unit-tested in `useCategoryGuess.test.ts`.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    currentLanguage: ref('en'),
    isLoading: ref(false),
    isEnglish: ref(true),
    isBeanieMode: ref(false),
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

vi.mock('@/utils/categorySuggest', () => ({
  suggestActivityCategory: (text: string) => {
    const s = text.toLowerCase();
    if (s.includes('birthday party')) return { value: 'birthday', word: 'birthday party' };
    if (s.includes('birthday')) return { value: 'occasion_birthday', word: 'birthday' };
    if (s.includes('anniversary')) return { value: 'anniversary', word: 'anniversary' };
    if (s.includes('softball')) return { value: 'softball', word: 'softball' };
    return undefined;
  },
}));

import ActivityModal from '@/components/planner/ActivityModal.vue';
import CategoryGuessHint from '@/components/ui/CategoryGuessHint.vue';
import ActivityCategoryPicker from '@/components/ui/ActivityCategoryPicker.vue';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import type { FamilyActivity } from '@/types/models';

const savedSoftball: FamilyActivity = {
  id: 'act-1',
  title: 'Team practice',
  date: '2026-11-07',
  recurrence: 'none',
  category: 'softball',
  assigneeIds: ['m'],
  feeSchedule: 'none',
  reminderMinutes: 30,
  isActive: true,
  createdBy: 'm',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as unknown as FamilyActivity;

type Vm = {
  title: string;
  category: string;
  icon: string;
  color: string;
  occasionMode: boolean;
  handleSave: () => void;
};

beforeEach(() => {
  setActivePinia(createPinia());
  logEvent.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

function mountClosed() {
  return mount(ActivityModal, {
    props: { open: false, activity: null },
    global: {
      stubs: {
        MagicBeansDoor: { template: '<div><slot name="trigger" :open="() => {}" /></div>' },
        PhotoAttachments: {
          template: '<div />',
          methods: { addFiles: () => Promise.resolve(), openPicker: () => {} },
        },
        BeanieFormModal: { template: '<div><slot /></div>' },
        teleport: true,
      },
    },
  });
}

async function flush() {
  await nextTick();
  await nextTick();
}

async function open(w: VueWrapper, props: Record<string, unknown>) {
  await w.setProps({ open: true, activity: null, ...props });
  await flush();
}

async function openNew() {
  const w = mountClosed();
  await open(w, {});
  return { w, vm: w.vm as unknown as Vm };
}

/** Typing without leaving the field: `input` only. (`setValue` also fires `change`, a commit.) */
async function type(w: VueWrapper, text: string) {
  const input = w.find('input[placeholder="modal.whatsTheActivity"]');
  (input.element as HTMLInputElement).value = text;
  await input.trigger('input');
  await flush();
}

const hint = (w: VueWrapper) => w.findComponent(CategoryGuessHint);

/** A pick from the real category picker, so the template wiring (`categoryGuess.pick`) is pinned. */
async function pick(w: VueWrapper, id: string) {
  w.findComponent(ActivityCategoryPicker).vm.$emit('update:modelValue', id);
  await flush();
}

const outcomes = () =>
  logEvent.mock.calls
    .map((c) => c[0] as { surface: string; message: string; context: Record<string, unknown> })
    .filter((e) => e.surface === 'category-guess' && e.message === 'submitted')
    .map((e) => e.context);

describe('ActivityModal: category guess', () => {
  it('⭐ the title picks the category, the icon follows, and the hint names the word', async () => {
    const { w, vm } = await openNew();
    await type(w, 'Softball practice');
    expect(vm.category).toBe('softball');
    expect(vm.icon).toBe(getActivityFallbackEmoji('softball'));
    expect(hint(w).props('label')).toBe('Softball');
    expect(hint(w).props('word')).toBe('softball');
  });

  it('⭐ a guess that clears leaves no icon or colour behind', async () => {
    const { w, vm } = await openNew();
    await type(w, 'Softball');
    expect(vm.color).not.toBe('');
    await type(w, 'Meeting');
    expect(vm.category).toBe('');
    expect(vm.icon).toBe('');
    expect(vm.color).toBe('');
    expect(hint(w).props('label')).toBeUndefined();
  });

  it('⭐ a hand pick survives further typing, even a tap on the guessed chip', async () => {
    const { w, vm } = await openNew();
    await type(w, 'Softball');
    await pick(w, 'softball');
    await type(w, 'Meeting');
    expect(vm.category).toBe('softball');
    expect(hint(w).props('label')).toBeUndefined();
  });

  it('a picked occasion goes through the occasion-aware writer and starts occasion mode', async () => {
    const { w, vm } = await openNew();
    await type(w, 'Softball');
    await pick(w, 'occasion_birthday');
    expect(vm.category).toBe('occasion_birthday');
    expect(vm.occasionMode).toBe(true);
  });

  it('⭐ an occasion is shown but only written when the title is committed', async () => {
    const { w, vm } = await openNew();
    await type(w, "Mia's birthday");
    expect(vm.category).toBe('');
    expect(hint(w).props('word')).toBe('birthday');
    // Typed on without leaving the field: the party, no occasion mode.
    await type(w, "Mia's birthday party");
    expect(vm.category).toBe('birthday');

    const b = await openNew();
    await type(b.w, "Mia's birthday");
    await b.w.find('input[placeholder="modal.whatsTheActivity"]').trigger('change');
    await flush();
    expect(b.vm.category).toBe('occasion_birthday');
    // Once committed it is a pick: later typing does not change it.
    await type(b.w, 'Softball');
    expect(b.vm.category).toBe('occasion_birthday');
  });

  it('⭐ Change on a pending occasion declines it: leaving the title does not commit it', async () => {
    const { w, vm } = await openNew();
    await type(w, "Mia's birthday");
    // A pending guess holds the focus in the title; a written one never does.
    expect(hint(w).props('holdFocus')).toBe(true);
    hint(w).vm.$emit('change');
    await flush();
    expect(hint(w).props('label')).toBeUndefined();
    // The next press anywhere blurs the title: no occasion, no occasion defaults.
    await w.find('input[placeholder="modal.whatsTheActivity"]').trigger('change');
    await flush();
    expect(vm.category).toBe('');
    expect(vm.occasionMode).toBe(false);
    // A hand pick still works, an occasion included.
    await pick(w, 'occasion_birthday');
    expect(vm.category).toBe('occasion_birthday');
    expect(vm.occasionMode).toBe(true);
  });

  it('⭐ a decline holds only for that occasion: a different one still commits on leaving', async () => {
    const { w, vm } = await openNew();
    const title = () => w.find('input[placeholder="modal.whatsTheActivity"]');
    await type(w, "Bob's birthday");
    hint(w).vm.$emit('change');
    await flush();
    await type(w, "Mum and Dad's anniversary");
    expect(hint(w).props('word')).toBe('anniversary');
    await title().trigger('change');
    await flush();
    expect(vm.category).toBe('anniversary');
    expect(vm.occasionMode).toBe(true);

    // Retitled back to a birthday: still declined, so leaving the title commits nothing new.
    const b = await openNew();
    await type(b.w, "Bob's birthday");
    hint(b.w).vm.$emit('change');
    await flush();
    await type(b.w, "Mum and Dad's anniversary");
    await type(b.w, "Bob's birthday");
    expect(hint(b.w).props('label')).toBeUndefined();
    await b.w.find('input[placeholder="modal.whatsTheActivity"]').trigger('change');
    await flush();
    expect(b.vm.category).toBe('');
    expect(b.vm.occasionMode).toBe(false);
  });

  it('declining a second occasion never brings back the first', async () => {
    const { w, vm } = await openNew();
    await type(w, "Bob's birthday");
    hint(w).vm.$emit('change');
    await flush();
    await type(w, "Mum and Dad's anniversary");
    hint(w).vm.$emit('change');
    await flush();
    await type(w, "Bob's birthday");
    expect(hint(w).props('label')).toBeUndefined();
    await w.find('input[placeholder="modal.whatsTheActivity"]').trigger('change');
    await flush();
    expect(vm.category).toBe('');
    expect(vm.occasionMode).toBe(false);
  });

  it('a written guess never holds the focus', async () => {
    const { w } = await openNew();
    await type(w, 'Softball');
    expect(hint(w).props('holdFocus')).toBeFalsy();
  });

  it('a reopened drawer forgets the decline: leaving the title commits again', async () => {
    const { w, vm } = await openNew();
    await type(w, "Mia's birthday");
    hint(w).vm.$emit('change');
    await flush();
    await w.setProps({ open: false });
    await flush();
    await open(w, {});
    await type(w, "Jo's birthday");
    await w.find('input[placeholder="modal.whatsTheActivity"]').trigger('change');
    await flush();
    expect(vm.category).toBe('occasion_birthday');
  });

  it('⭐ the reused drawer opened for an edit keeps the saved category', async () => {
    const { w, vm } = await openNew();
    await type(w, 'Softball practice');
    expect(vm.category).toBe('softball');
    await w.setProps({ open: false });
    await flush();
    await open(w, { activity: savedSoftball });
    expect(vm.category).toBe('softball');
    await type(w, 'Team meeting');
    expect(vm.category).toBe('softball');
    expect(hint(w).props('label')).toBeUndefined();
  });

  it('Change scrolls to the category picker', async () => {
    const { w } = await openNew();
    await type(w, 'Softball');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hint(w).vm.$emit('change');
    await flush();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(logEvent.mock.calls.some((c) => c[0].message === 'picker not found')).toBe(false);
  });

  it('logs one outcome per new-activity save, and none for an edit', async () => {
    const a = await openNew();
    await type(a.w, 'Softball');
    a.vm.handleSave();
    expect(outcomes()).toEqual([{ kind: 'activity', action: 'kept' }]);

    logEvent.mockClear();
    const b = await openNew();
    await type(b.w, 'Softball');
    await pick(b.w, 'doctor');
    b.vm.handleSave();
    expect(outcomes()).toEqual([{ kind: 'activity', action: 'changed' }]);

    logEvent.mockClear();
    const c = mountClosed();
    await open(c, { activity: savedSoftball });
    (c.vm as unknown as Vm).title = 'Renamed';
    await flush();
    (c.vm as unknown as Vm).handleSave();
    expect(outcomes()).toEqual([]);
  });
});
