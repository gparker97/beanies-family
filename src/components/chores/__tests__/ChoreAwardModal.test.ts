/**
 * Stars and rewards (#148): the award form. What these pin (read through the real English
 * strings, so the calculator's words are checked, not just its keys):
 *  - a new award is Saved Up, One Time, priced in full weeks;
 *  - the calculator both ways: full weeks typed shows the stars per kid ("80 to 160"), stars typed
 *    shows the full weeks per kid ("2 to 4"), and the per-child table follows;
 *  - the fairness nudge for an uneven stars price, and its one tap to a full-weeks price;
 *  - the real-time estimate at the family's bar; This Week says when it takes bonus stars;
 *  - One Time / Repeats only for Saved Up, and what each saves;
 *  - a name and a valid price are required (nothing is written without them);
 *  - create, edit and delete (behind the confirm) call the right store action and close only on a
 *    non-null result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock('@/composables/useTranslation', async () => {
  const { computed } = await import('vue');
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  const strings = UI_STRINGS as Record<string, string>;
  return {
    useTranslation: () => ({
      t: (k: string) => strings[k] ?? k,
      currentLanguage: computed(() => 'en'),
    }),
  };
});
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
const confirmFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn }));

const ss = vi.hoisted(() => ({
  fulls: {} as Record<string, number>,
  weeklyOn: true,
  saveAward: vi.fn(),
  deleteAward: vi.fn(),
}));
vi.mock('@/stores/starStore', async () => {
  const kit = await import('./choreTestKit');
  return {
    useStarStore: () => ({
      earners: ['kid', 'sib'],
      get earnerMembers() {
        return kit.earnerMembersOf(['kid', 'sib']);
      },
      get rewards() {
        return { on: true, weeklyOn: ss.weeklyOn, barPct: 80 };
      },
      weekFor: (id: string) => (id in ss.fulls ? { full: ss.fulls[id] } : null),
      saveAward: ss.saveAward,
      deleteAward: ss.deleteAward,
    }),
  };
});

import ChoreAwardModal from '../ChoreAwardModal.vue';
import { resetKit } from './choreTestKit';
import type { ChoreAward } from '@/types/models';

const stubs = {
  BeanieFormModal: defineComponent({
    name: 'BeanieFormModal',
    props: [
      'variant',
      'size',
      'open',
      'title',
      'saveLabel',
      'saveReady',
      'showDelete',
      'isSubmitting',
    ],
    emits: ['save', 'close', 'delete'],
    template:
      '<div v-if="open"><h2 data-testid="title">{{ title }}</h2><slot /><button data-testid="save" @click="$emit(\'save\')">{{ saveLabel }}</button><button v-if="showDelete" data-testid="delete" @click="$emit(\'delete\')" /></div>',
  }),
  FormFieldGroup: defineComponent({
    props: ['label', 'error', 'errorMessage', 'required'],
    template:
      '<div :data-label="label" :data-error="error ? \'true\' : undefined"><slot /><p v-if="error && errorMessage" data-testid="field-error">{{ errorMessage }}</p></div>',
  }),
  BeanieAvatar: true,
};

const AWARD: ChoreAward = {
  id: 'a1',
  title: 'Disneyland',
  emoji: '🏰',
  kind: 'saved',
  unit: 'stars',
  price: 80,
  repeats: true,
  weekStart: '2026-11-09',
  createdBy: 'mom',
  createdAt: '2026-11-10',
  updatedAt: '2026-11-10',
};

async function openModal(award: ChoreAward | null = null): Promise<VueWrapper> {
  const w = mount(ChoreAwardModal, { props: { open: false, award }, global: { stubs } });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

const box = (w: VueWrapper, unit: 'weeks' | 'stars') =>
  w.get(`input[data-testid="chore-award-${unit}"]`);
const boxValue = (w: VueWrapper, unit: 'weeks' | 'stars') =>
  (box(w, unit).element as HTMLInputElement).value;
const childValues = (w: VueWrapper) =>
  w.findAll('[data-testid="chore-award-child-value"]').map((e) => e.text());
const tab = (w: VueWrapper, group: string, label: string) =>
  w.findAll(`[data-testid="${group}"] button`).find((b) => b.text() === label)!;

beforeEach(() => {
  resetKit();
  toast.mockReset();
  ss.fulls = { kid: 40, sib: 20 };
  ss.weeklyOn = true;
  ss.saveAward.mockReset();
  ss.saveAward.mockResolvedValue({ id: 'new' });
  ss.deleteAward.mockReset();
  ss.deleteAward.mockResolvedValue(true);
  confirmFn.mockReset();
});

describe('ChoreAwardModal: the calculator', () => {
  it('is the right-hand drawer, as the chore editors are', async () => {
    const w = await openModal();
    expect(w.findComponent({ name: 'BeanieFormModal' }).props()).toMatchObject({
      variant: 'drawer',
      size: 'narrow',
    });
  });

  it('a new award: Saved Up, One Time, priced in full weeks', async () => {
    const w = await openModal();
    expect(w.get('[data-testid="title"]').text()).toBe('New Special Reward');
    expect(w.get('[data-testid="chore-award-box-weeks"]').attributes('data-active')).toBe('true');
    expect(w.find('[data-testid="chore-award-repeats"]').exists()).toBe(true);
    expect(w.get('[data-testid="chore-award-repeats-hint"]').text()).toContain('stays achieved');
  });

  it("full weeks typed: the stars box and the table show each kid's stars", async () => {
    const w = await openModal();
    await box(w, 'weeks').setValue('4');
    expect(boxValue(w, 'stars')).toBe('80 to 160');
    expect(childValues(w)).toEqual(['160 stars', '80 stars']);
    expect(w.find('[data-testid="chore-award-nudge"]').exists()).toBe(false);
    expect(w.get('[data-testid="chore-award-estimate"]').text()).toContain(
      'If each week reaches 80% of a full week, about 5 weeks for everyone.'
    );
  });

  it("stars typed: the weeks box and the table show each kid's full weeks, and the nudge", async () => {
    const w = await openModal();
    await box(w, 'stars').setValue('80');
    expect(w.get('[data-testid="chore-award-box-stars"]').attributes('data-active')).toBe('true');
    expect(boxValue(w, 'weeks')).toBe('2 to 4');
    expect(childValues(w)).toEqual(['2 full weeks', '4 full weeks']);
    const nudge = w.get('[data-testid="chore-award-nudge"]');
    expect(nudge.text()).toContain('Same stars, different effort.');
    expect(nudge.text()).toContain('Juno would need 2 times as long as Pip.');
    expect(w.get('[data-testid="chore-award-estimate"]').text()).toContain('3 to 5 weeks');
    // One tap: the same price as full weeks (80 stars at the average full week of 30).
    await w.get('[data-testid="chore-award-nudge-action"]').trigger('click');
    expect(w.get('[data-testid="chore-award-box-weeks"]').attributes('data-active')).toBe('true');
    expect(boxValue(w, 'weeks')).toBe('2.7');
    expect(w.find('[data-testid="chore-award-nudge"]').exists()).toBe(false);
  });

  it('an even stars price has no nudge', async () => {
    ss.fulls = { kid: 30, sib: 26 };
    const w = await openModal();
    await box(w, 'stars').setValue('60');
    expect(w.find('[data-testid="chore-award-nudge"]').exists()).toBe(false);
    expect(childValues(w)).toEqual(['2 full weeks', 'about 2.3 full weeks']);
  });

  it('This Week: no One Time / Repeats; a price above a full week says it takes bonus stars', async () => {
    const w = await openModal();
    await tab(w, 'chore-award-kind', 'This Week').trigger('click');
    expect(w.find('[data-testid="chore-award-repeats"]').exists()).toBe(false);
    expect(w.get('[data-testid="chore-award-kind-hint"]').text()).toContain(
      'starts again every week'
    );
    await box(w, 'weeks').setValue('1');
    expect(w.find('[data-testid="chore-award-estimate"]').exists()).toBe(false);
    await box(w, 'weeks').setValue('1.1');
    expect(w.get('[data-testid="chore-award-estimate"]').text()).toContain(
      'That is more than a full week, so it takes bonus stars.'
    );
  });
});

describe('ChoreAwardModal: the special reward vocabulary', () => {
  it('every stars-and-rewards string says "special reward", never "award" or "extra credit"', async () => {
    const { UI_STRINGS, BEANIE_STRINGS } = await import('@/services/translation/uiStrings');
    const { ZH_STRINGS } = await import('@/services/translation/zh');
    const en = UI_STRINGS as Record<string, string>;
    expect(en['choreStars.awards.title']).toBe('Extra Special Rewards');
    expect(en['choreStars.awards.add']).toBe('Add Special Reward');
    expect(en['choreStars.awardForm.newTitle']).toBe('New Special Reward');
    expect(en['choreStars.awardForm.editTitle']).toBe('Edit Special Reward');
    expect(en['choreStars.awardForm.delete.title']).toBe('Delete Special Reward?');
    expect(en['choreStars.awards.empty']).toContain('A special reward is for something bigger');
    const values = (table: Record<string, string>) =>
      Object.entries(table)
        .filter(([k]) => k.startsWith('choreStars.'))
        .map(([, v]) => v.toLowerCase());
    for (const v of [...values(en), ...values(BEANIE_STRINGS as Record<string, string>)]) {
      expect(v).not.toMatch(/award|extra credit|moved back/);
    }
    for (const v of values(ZH_STRINGS as Record<string, string>)) {
      expect(v).not.toContain('额外奖励');
    }
  });
});

describe('ChoreAwardModal: saving', () => {
  it('nothing is written without a name and a valid price', async () => {
    const w = await openModal();
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).not.toHaveBeenCalled();
    expect(w.findAll('[data-testid="field-error"]').length).toBe(2);
    await w.get('input[data-testid="chore-award-title"]').setValue('Bowling');
    await box(w, 'weeks').setValue('abc');
    expect(w.get('[data-testid="field-error"]').text()).toBe(
      'Use a number above 0, like 4 or 1.5.'
    );
    await box(w, 'stars').setValue('2.5');
    expect(w.get('[data-testid="field-error"]').text()).toBe('Use a whole number above 0.');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).not.toHaveBeenCalled();
  });

  it('create: one saveAward with the draft (Repeats as chosen), then closes', async () => {
    const w = await openModal();
    await w.get('input[data-testid="chore-award-title"]').setValue('  Bowling ');
    await box(w, 'weeks').setValue('2');
    await tab(w, 'chore-award-repeats', 'Repeats').trigger('click');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledWith(
      { title: 'Bowling', emoji: '🎳', kind: 'saved', unit: 'weeks', price: 2, repeats: true },
      'mom'
    );
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('This Week saves no repeats', async () => {
    const w = await openModal();
    await w.get('input[data-testid="chore-award-title"]').setValue('Movie pick');
    await tab(w, 'chore-award-repeats', 'Repeats').trigger('click');
    await tab(w, 'chore-award-kind', 'This Week').trigger('click');
    await box(w, 'stars').setValue('12');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'week', unit: 'stars', price: 12, repeats: undefined }),
      'mom'
    );
  });

  it('stays open on a null result (the store has toasted), never toasting itself', async () => {
    ss.saveAward.mockResolvedValue(null);
    const w = await openModal();
    await w.get('input[data-testid="chore-award-title"]').setValue('Bowling');
    await box(w, 'weeks').setValue('2');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledTimes(1);
    expect(w.emitted('close')).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it('edit: seeded from the award, saved with its id', async () => {
    const w = await openModal(AWARD);
    expect(w.get('[data-testid="title"]').text()).toBe('Edit Special Reward');
    expect(
      (w.get('input[data-testid="chore-award-title"]').element as HTMLInputElement).value
    ).toBe('Disneyland');
    expect(boxValue(w, 'stars')).toBe('80');
    expect(w.get('[data-testid="chore-award-repeats-hint"]').text()).toContain('starts again');
    await box(w, 'stars').setValue('90');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', price: 90, unit: 'stars', repeats: true }),
      'mom'
    );
  });

  it('delete: behind the confirm; declined writes nothing, confirmed deletes and closes', async () => {
    const w = await openModal(AWARD);
    confirmFn.mockResolvedValue(false);
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(ss.deleteAward).not.toHaveBeenCalled();
    confirmFn.mockResolvedValue(true);
    await w.get('[data-testid="delete"]').trigger('click');
    await flushPromises();
    expect(ss.deleteAward).toHaveBeenCalledWith('a1', 'mom');
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('a new award offers no delete', async () => {
    const w = await openModal();
    expect(w.find('[data-testid="delete"]').exists()).toBe(false);
  });
});

describe("ChoreAwardModal: the emoji changes when the name's suggestion changes", () => {
  const emojiShown = (w: VueWrapper) => w.get('[data-testid="chore-award-emoji"]').text();
  const titleInput = (w: VueWrapper) => w.get('input[data-testid="chore-award-title"]');
  async function pickByHand(w: VueWrapper, emoji: string): Promise<void> {
    await w.get('[data-testid="chore-award-emoji"]').trigger('click');
    await w
      .findAll('[data-testid="chore-award-emoji-picker"] button')
      .find((b) => b.text().includes(emoji))!
      .trigger('click');
    expect(emojiShown(w)).toBe(emoji);
  }
  async function saveAt2Weeks(w: VueWrapper): Promise<void> {
    await box(w, 'weeks').setValue('2');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
  }

  it('follows the name as it is typed (the default while nothing matches)', async () => {
    const w = await openModal();
    expect(emojiShown(w)).toBe('🎁');
    await titleInput(w).setValue('Disneyland');
    expect(emojiShown(w)).toBe('🏰');
    await titleInput(w).setValue('Movie night');
    expect(emojiShown(w)).toBe('🎬');
  });

  it('"Ice cream", the piggy bank by hand, then "Allowance": money, and it is what is saved', async () => {
    const w = await openModal();
    await titleInput(w).setValue('Ice cream');
    expect(emojiShown(w)).toBe('🍦');
    await pickByHand(w, '🐷');
    await titleInput(w).setValue('Allowance');
    expect(emojiShown(w)).toBe('💵');
    await saveAt2Weeks(w);
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Allowance', emoji: '💵' }),
      'mom'
    );
  });

  it('a hand pick stays through a rename with the same suggestion, or none', async () => {
    const w = await openModal();
    await titleInput(w).setValue('Allowance');
    await pickByHand(w, '🐷');
    await titleInput(w).setValue('Weekly allowance');
    expect(emojiShown(w)).toBe('🐷');
    await titleInput(w).setValue('Something nice');
    expect(emojiShown(w)).toBe('🐷');
    await saveAt2Weeks(w);
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Something nice', emoji: '🐷' }),
      'mom'
    );
  });

  it('opening an existing one leaves its emoji, even one its name would not pick', async () => {
    const w = await openModal({ ...AWARD, title: 'Ice cream', emoji: '🐷' });
    expect(emojiShown(w)).toBe('🐷');
    await titleInput(w).setValue('Ice cream sundae');
    expect(emojiShown(w)).toBe('🐷');
    await titleInput(w).setValue('Allowance');
    expect(emojiShown(w)).toBe('💵');
  });
});

describe('ChoreAwardModal: who it is for', () => {
  const pickKid = async (w: VueWrapper, name: string) => {
    const chip = w
      .findAll('[data-testid="chore-award-who-kids"] button')
      .find((b) => b.text().includes(name))!;
    await chip.trigger('click');
  };

  it('All Kids by default: saved as every kid (no memberIds)', async () => {
    const w = await openModal();
    expect(w.get('[data-testid="chore-award-who-hint"]').text()).toContain(
      'including any who join'
    );
    expect(w.find('[data-testid="chore-award-who-kids"]').exists()).toBe(false);
    await w.get('input[data-testid="chore-award-title"]').setValue('Zoo');
    await box(w, 'weeks').setValue('2');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward.mock.calls[0]![0].memberIds).toBeUndefined();
  });

  it('Pick Kids needs at least one; one kid chosen: the table is that kid only and there is no nudge', async () => {
    const w = await openModal();
    await w.get('input[data-testid="chore-award-title"]').setValue('Zoo');
    await tab(w, 'chore-award-who', 'Pick Kids').trigger('click');
    await box(w, 'stars').setValue('80');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).not.toHaveBeenCalled();
    expect(w.text()).toContain('Pick at least one child.');
    await pickKid(w, 'Juno');
    expect(
      w.findAll('[data-testid="chore-award-child"]').map((r) => r.attributes('data-member-id'))
    ).toEqual(['sib']);
    expect(childValues(w)).toEqual(['4 full weeks']);
    expect(boxValue(w, 'weeks')).toBe('4');
    expect(w.find('[data-testid="chore-award-nudge"]').exists()).toBe(false);
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: ['sib'] }),
      'mom'
    );
  });

  it('every kid picked is sent as both (the store stores it as every kid); editing seeds the picks', async () => {
    const w = await openModal({ ...AWARD, memberIds: ['sib', 'left-the-family'] });
    expect(w.find('[data-testid="chore-award-who-kids"]').exists()).toBe(true);
    const pressed = w
      .findAll('[data-testid="chore-award-who-kids"] button')
      .filter((b) => b.classes().includes('border-primary-500'))
      .map((b) => b.text());
    expect(pressed).toEqual([expect.stringContaining('Juno')]);
    await pickKid(w, 'Pip');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(ss.saveAward).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', memberIds: ['kid', 'sib'] }),
      'mom'
    );
  });
});
