/**
 * Stars and rewards (#148): the gift modal (Give Bonus / Take Away). What these pin:
 *  - it opens on the kid it was opened for (a kid's day), else the first kid;
 *  - a bonus needs no note and calls `giveStars` once with the kid, the kind and the count;
 *  - a take-away needs a short reason (Save rings the field and writes nothing without one);
 *  - a take-away is capped at the kid's stars this week (the stepper's top, and the line beside
 *    it); with none, it says there is nothing to take away and Save is unavailable;
 *  - the wording is give / take away ("Give Bonus / Take Away", "Take Away 1 Star");
 *  - the preview shows the exact note the kid will read;
 *  - it closes only on a non-null result and never toasts (the store already has).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({
  showToast: toast,
  useToast: () => ({ showToast: toast }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

const ss = vi.hoisted(() => ({
  totals: {} as Record<string, number>,
  giveStars: vi.fn(),
}));
vi.mock('@/stores/starStore', async () => {
  const kit = await import('./choreTestKit');
  return {
    useStarStore: () => ({
      earners: ['kid', 'sib'],
      get earnerMembers() {
        return kit.earnerMembersOf(['kid', 'sib']);
      },
      rewards: { on: true, weeklyOn: true, barPct: 80 },
      weekFor: (id: string) => (id in ss.totals ? { total: ss.totals[id] } : null),
      giveStars: ss.giveStars,
    }),
  };
});

import StarGiftModal from '../StarGiftModal.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import { family, resetKit } from './choreTestKit';

const ChipPickerStub = defineComponent({
  name: 'FamilyChipPicker',
  props: ['modelValue', 'members', 'mode'],
  emits: ['update:modelValue'],
  template: '<div data-testid="who" :data-value="modelValue" />',
});

const stubs = {
  BeanieFormModal: defineComponent({
    name: 'BeanieFormModal',
    props: [
      'variant',
      'size',
      'open',
      'title',
      'saveLabel',
      'saveDisabled',
      'saveReady',
      'isSubmitting',
    ],
    emits: ['save', 'close'],
    template:
      '<div v-if="open"><h2 data-testid="title">{{ title }}</h2><slot /><button data-testid="save" :data-ready="saveReady ? \'true\' : \'false\'" :disabled="saveDisabled || isSubmitting" @click="$emit(\'save\')">{{ saveLabel }}</button></div>',
  }),
  FormFieldGroup: defineComponent({
    props: ['label', 'error', 'errorMessage', 'required'],
    template:
      '<div :data-label="label" :data-error="error ? \'true\' : undefined"><slot /><p v-if="error && errorMessage" data-testid="field-error">{{ errorMessage }}</p></div>',
  }),
  FamilyChipPicker: ChipPickerStub,
  BeanieAvatar: true,
};

async function openModal(memberId: string | null = null): Promise<VueWrapper> {
  const w = mount(StarGiftModal, { props: { open: false, memberId }, global: { stubs } });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

const kindTab = (w: VueWrapper, label: string) =>
  w.findAll('[data-testid="star-gift-kind"] button').find((b) => b.text() === label)!;

beforeEach(() => {
  resetKit();
  family.members = family.members.map((m) => (m.id === 'dad' ? { ...m, name: 'Papa Bean' } : m));
  family.currentMemberId = 'dad';
  toast.mockReset();
  ss.totals = { kid: 5, sib: 0 };
  ss.giveStars.mockReset();
  ss.giveStars.mockResolvedValue({ id: 'g1' });
});

describe('StarGiftModal', () => {
  it('is the right-hand drawer, as the chore editors are', async () => {
    const w = await openModal();
    expect(w.findComponent({ name: 'BeanieFormModal' }).props()).toMatchObject({
      variant: 'drawer',
      size: 'narrow',
    });
  });

  it('opens on the kid it was opened for, else the first kid', async () => {
    const forSib = await openModal('sib');
    expect(forSib.get('[data-testid="who"]').attributes('data-value')).toBe('sib');
    const none = await openModal(null);
    expect(none.get('[data-testid="who"]').attributes('data-value')).toBe('kid');
    expect(
      (none.findComponent(ChipPickerStub).props('members') as { id: string }[]).map((m) => m.id)
    ).toEqual(['kid', 'sib']);
  });

  it('a bonus needs no note: one giveStars with the kid, the kind and the count, then closes', async () => {
    const w = await openModal('kid');
    await w.get('[data-testid="stepper-increase"]').trigger('click');
    expect(w.get('[data-testid="save"]').text()).toBe('choreStars.bonus.save.other');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.giveStars).toHaveBeenCalledTimes(1);
    expect(ss.giveStars).toHaveBeenCalledWith(
      { memberId: 'kid', kind: 'bonus', count: 2, note: undefined },
      'dad'
    );
    expect(w.emitted('close')).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays open, with the input kept, when the store answers null (it has toasted already)', async () => {
    ss.giveStars.mockResolvedValue(null);
    const w = await openModal('kid');
    await w.get('input[data-testid="star-gift-note"]').setValue('Helped');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.giveStars).toHaveBeenCalledWith(expect.objectContaining({ note: 'Helped' }), 'dad');
    expect(w.emitted('close')).toBeUndefined();
    expect((w.get('input[data-testid="star-gift-note"]').element as HTMLInputElement).value).toBe(
      'Helped'
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('a take-away needs a short reason: Save rings the field and writes nothing', async () => {
    const w = await openModal('kid');
    await kindTab(w, 'choreStars.takeBack.tab').trigger('click');
    expect(w.get('[data-testid="title"]').text()).toBe('choreStars.takeBack.title');
    expect(w.get('[data-testid="save"]').attributes('data-ready')).toBe('false');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.giveStars).not.toHaveBeenCalled();
    expect(w.get('[data-testid="field-error"]').text()).toBe('choreStars.error.noteRequired');
    await w.get('input[data-testid="star-gift-note"]').setValue('Bike left out in the rain');
    // The ring goes as soon as there is a reason.
    expect(w.find('[data-testid="field-error"]').exists()).toBe(false);
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.giveStars).toHaveBeenCalledWith(
      { memberId: 'kid', kind: 'take', count: 1, note: 'Bike left out in the rain' },
      'dad'
    );
  });

  it("a take-away is capped at the kid's stars this week, and says so", async () => {
    ss.totals.kid = 3;
    const w = await openModal('kid');
    const stepper = () => w.findComponent(NumberStepper);
    expect(stepper().props('max')).toBe(20);
    stepper().vm.$emit('update:modelValue', 7);
    await flushPromises();
    await kindTab(w, 'choreStars.takeBack.tab').trigger('click');
    await flushPromises();
    expect(stepper().props('max')).toBe(3);
    // The count is pulled down to the cap.
    expect(stepper().props('modelValue')).toBe(3);
    expect(w.get('[data-testid="star-gift-count-hint"]').text()).toBe(
      'choreStars.takeBack.most.other'
    );
  });

  it('with no stars this week there is nothing to take away: it says so and Save is unavailable', async () => {
    const w = await openModal('sib');
    await kindTab(w, 'choreStars.takeBack.tab').trigger('click');
    expect(w.find('[data-testid="star-gift-none"]').exists()).toBe(true);
    expect(w.find('[data-testid="star-gift-preview"]').exists()).toBe(false);
    expect(w.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
  });

  it('the preview is the note the kid will read, signed by the grown-up', async () => {
    const w = await openModal('kid');
    const note = () => w.get('[data-testid="star-gift-preview"] [data-testid="star-note"]');
    expect(note().attributes('data-kind')).toBe('bonus');
    expect(note().text()).toContain('choreStars.bonus.note.title.one');
    await kindTab(w, 'choreStars.takeBack.tab').trigger('click');
    await w.get('input[data-testid="star-gift-note"]').setValue('Bike');
    expect(note().attributes('data-kind')).toBe('take');
    expect(note().text()).toContain('choreStars.takeBack.note.title.one');
    expect(note().text()).toContain('choreStars.takeBack.note.quotePeriod');
    expect(note().text()).toContain('choreStars.takeBack.note.forward.one');
    // Never red, never "lost".
    expect(note().classes().join(' ')).not.toMatch(/red|danger/);
  });

  it('the wording is give / take away, in real English', async () => {
    const { UI_STRINGS } = await import('@/services/translation/uiStrings');
    expect(UI_STRINGS['choreStars.bonus.tab']).toBe('Give Bonus');
    expect(UI_STRINGS['choreStars.takeBack.tab']).toBe('Take Away');
    expect(UI_STRINGS['choreStars.takeBack.save.one']).toBe('Take Away {count} Star');
    expect(UI_STRINGS['choreStars.takeBack.save.other']).toBe('Take Away {count} Stars');
    expect(UI_STRINGS['choreStars.takeBack.title']).toBe('Take Away Stars');
    for (const value of Object.values(UI_STRINGS)) {
      expect(value.toLowerCase()).not.toContain('moved back');
    }
  });
});
