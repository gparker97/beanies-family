/**
 * Add Chores (#146), the one-list sheet (owner decisions, 2026-11-13): set chips open a
 * read-only preview whose "Add N to List" appends the set under its headings (duplicates dimmed
 * and left out); "Remove from List" takes back only unedited rows; rows can be re-timed,
 * removed, renamed the list-entry way (Enter, blur, Escape) and added under any block; the
 * button counts named rows; one `addChores` call; the list is the session's (kept across close
 * and reopen, cleared after an Add, by Clear List and on sign-out); `?starter=` adds a set
 * straight in; the built-in set definitions are never touched; an IME Enter is typing; a row
 * of the grown-up's own takes its picture from its title until one is picked by hand; no
 * chooser leaves an Escape token behind when the sheet closes or its row goes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import ChoreAddSheet from '../ChoreAddSheet.vue';
import { clearChoreAddDraft, useChoreAddDraft } from '@/composables/useChoreAddDraft';
import { hasOpenEscapeLayer } from '@/composables/useEscapeClose';
import { choreActions, resetKit } from './choreTestKit';
import {
  CHORE_STARTER_SETS,
  choreStarterSet,
  type StarterChoreDraft,
} from '@/constants/choreStarterSets';

const PeopleStub = defineComponent({
  props: { modelValue: { type: Array, default: () => [] }, hintTestid: String },
  emits: ['update:modelValue'],
  template: '<div><slot name="hint" /></div>',
});
const PictureStub = defineComponent({
  props: { emoji: String, illustration: String },
  emits: ['update:emoji', 'update:illustration'],
  template: '<div data-testid="picture-stub" />',
});

const stubs = {
  BaseModal: {
    props: ['open', 'title'],
    template:
      '<div v-if="open"><h1 data-testid="modal-title">{{ title }}</h1><slot /><slot name="footer" /></div>',
  },
  FormFieldGroup: {
    props: ['label'],
    template: '<div :data-label="label"><slot name="label-extra" /><slot /></div>',
  },
  ListPeoplePicker: PeopleStub,
  ChorePicturePicker: PictureStub,
  CardArt: true,
};

const mounted: VueWrapper[] = [];
async function openSheet(props: Record<string, unknown> = {}): Promise<VueWrapper> {
  const w = mount(ChoreAddSheet, {
    props: { open: false, ...props },
    global: { stubs },
    attachTo: document.body,
  });
  mounted.push(w);
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

const school = choreStarterSet('school-morning')!;
const bedtime = choreStarterSet('bedtime')!;
const pet = choreStarterSet('pet-care')!;

const draftRows = (w: VueWrapper) => w.findAll('[data-testid="chore-draft-row"]');
const blockRows = (w: VueWrapper, b: string) =>
  w.findAll(`[data-testid="chore-draft-row"][data-block="${b}"]`);
const rowOf = (w: VueWrapper, chore: string) =>
  w.get(`[data-testid="chore-draft-row"][data-chore="${chore}"]`);
const titleOf = (r: { get: VueWrapper['get'] }) =>
  r.get('[data-testid="chore-draft-title"]').element as HTMLInputElement;
const chip = (w: VueWrapper, set: string) =>
  w.get(`[data-testid="chore-suggest-chip"][data-set="${set}"]`);
const addButton = (w: VueWrapper) => w.get('[data-testid="chore-starter-add"]');
const sentDrafts = () => choreActions.addChores.mock.calls[0]![1] as StarterChoreDraft[];

async function addSetVia(w: VueWrapper, set: string) {
  await chip(w, set).trigger('click');
  await w.get('[data-testid="chore-set-preview-add"]').trigger('click');
  await flushPromises();
}
async function commitTitle(w: VueWrapper, chore: string, value: string) {
  const input = rowOf(w, chore).get('[data-testid="chore-draft-title"]');
  await input.trigger('focus');
  await input.setValue(value);
  await input.trigger('blur');
}
async function submit(w: VueWrapper) {
  await addButton(w).trigger('click');
  await flushPromises();
}

beforeEach(() => {
  resetKit();
  // The list is module state for the app session: each test starts empty.
  clearChoreAddDraft();
  toast.mockReset();
  choreActions.addChores.mockResolvedValue({ added: 4, skipped: 0 });
});
// Unmount every sheet, so no test inherits another's Escape tokens.
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('ChoreAddSheet: opening', () => {
  it('first time: the children, the chips, the hint and an add row per block; nothing to add', async () => {
    const w = await openSheet();
    expect(w.get('[data-testid="modal-title"]').text()).toBe('choreboard.addChores');
    expect(w.findComponent(PeopleStub).props('modelValue')).toEqual(['kid', 'sib']);
    expect(
      w.findAll('[data-testid="chore-suggest-chip"]').map((c) => c.attributes('data-set'))
    ).toEqual(CHORE_STARTER_SETS.map((s) => s.key));
    expect(w.find('[data-testid="chore-add-hint"]').text()).toBe('choreboard.add.hint');
    expect(
      w.findAll('[data-testid="chore-add-row"]').map((r) => r.attributes('data-block'))
    ).toEqual(['morning', 'afternoon', 'evening', 'anytime']);
    // No headings without rows, no Clear List, nothing to add.
    expect(w.findAll('[data-testid="chore-add-block"] h3')).toHaveLength(0);
    expect(w.find('[data-testid="chore-add-clear"]').exists()).toBe(false);
    expect(addButton(w).attributes('disabled')).toBeDefined();
    expect(addButton(w).text()).toBe('choreboard.starter.ctaNone');
  });

  it('?starter= adds that set straight to the list, with the page’s people', async () => {
    const w = await openSheet({ presetKey: 'bedtime', presetMemberIds: ['sib'], carried: true });
    expect(w.findComponent(PeopleStub).props('modelValue')).toEqual(['sib']);
    expect(chip(w, 'bedtime').attributes('data-on')).toBe('true');
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    expect(blockRows(w, 'evening')).toHaveLength(bedtime.chores.length);
    expect(w.find('[data-testid="chore-starter-carried"]').exists()).toBe(true);
    expect(addButton(w).text()).toBe('choreboard.starter.cta.other');
  });
});

describe('ChoreAddSheet: set previews', () => {
  it('a chip opens a read-only preview (one at a time); the chip again or ✕ collapses it', async () => {
    const w = await openSheet();
    await chip(w, 'school-morning').trigger('click');
    expect(chip(w, 'school-morning').attributes('aria-expanded')).toBe('true');
    const preview = w.get('[data-testid="chore-set-preview"]');
    expect(preview.attributes('data-set')).toBe('school-morning');
    expect(preview.findAll('[data-testid="chore-set-preview-row"]')).toHaveLength(
      school.chores.length
    );
    expect(preview.find('input').exists()).toBe(false);
    expect(preview.text()).toContain('choreboard.form.days.school');
    expect(w.get('[data-testid="chore-set-preview-add"]').text()).toBe(
      'choreboard.add.previewAdd.other'
    );
    // Nothing is on the list until Add to List.
    expect(draftRows(w)).toHaveLength(0);
    await chip(w, 'bedtime').trigger('click');
    expect(w.get('[data-testid="chore-set-preview"]').attributes('data-set')).toBe('bedtime');
    expect(chip(w, 'school-morning').attributes('aria-expanded')).toBe('false');
    await chip(w, 'bedtime').trigger('click');
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    await chip(w, 'pet-care').trigger('click');
    await w.get('[data-testid="chore-set-preview-close"]').trigger('click');
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    await chip(w, 'pet-care').trigger('click');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('Add to List appends the set under its headings, collapses and ticks the chip', async () => {
    const w = await openSheet();
    await addSetVia(w, 'pet-care');
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    expect(chip(w, 'pet-care').attributes('data-on')).toBe('true');
    expect(blockRows(w, 'morning').map((r) => r.attributes('data-chore'))).toEqual([
      'feed-breakfast',
      'fresh-water',
    ]);
    expect(blockRows(w, 'afternoon').map((r) => r.attributes('data-chore'))).toEqual(['walk-dog']);
    expect(blockRows(w, 'anytime').map((r) => r.attributes('data-chore'))).toEqual(['brush-pet']);
    expect(w.findAll('[data-testid="chore-add-block"] h3')).toHaveLength(4);
    // A set already on the list offers Remove from List.
    await chip(w, 'pet-care').trigger('click');
    expect(w.find('[data-testid="chore-set-preview-add"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-set-preview-remove"]').exists()).toBe(true);
  });

  it('two sets together; a chore already in the block is dimmed, left out of the count, added once', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    // A grown-up's own "Feed the pet" in the morning (the fake t returns the key).
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const mine = blockRows(w, 'morning').at(-1)!.get('[data-testid="chore-draft-title"]');
    await mine.trigger('focus');
    await mine.setValue(' CHOREBOARD.STARTERCHORE.FEEDPETBREAKFAST ');
    await mine.trigger('blur');
    await chip(w, 'pet-care').trigger('click');
    const dups = w.findAll('[data-testid="chore-set-preview-row"][data-dup="true"]');
    expect(dups).toHaveLength(1);
    expect(dups[0]!.text()).toContain('choreboard.add.previewDup');
    expect(dups[0]!.classes()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/opacity/)])
    );
    await w.get('[data-testid="chore-set-preview-add"]').trigger('click');
    await flushPromises();
    const morningTitles = blockRows(w, 'morning').map((r) => titleOf(r).value.trim().toLowerCase());
    expect(
      morningTitles.filter((x) => x === 'choreboard.starterchore.feedpetbreakfast')
    ).toHaveLength(1);
    expect(draftRows(w)).toHaveLength(school.chores.length + 1 + pet.chores.length - 1);
    expect(chip(w, 'school-morning').attributes('data-on')).toBe('true');
    expect(chip(w, 'pet-care').attributes('data-on')).toBe('true');
  });

  it('Remove from List takes back only that set’s unedited rows', async () => {
    const w = await openSheet();
    await addSetVia(w, 'bedtime');
    await addSetVia(w, 'tidy-up');
    await commitTitle(w, 'bath', 'Bubble bath');
    await chip(w, 'bedtime').trigger('click');
    await w.get('[data-testid="chore-set-preview-remove"]').trigger('click');
    await flushPromises();
    expect(chip(w, 'bedtime').attributes('data-on')).toBe('false');
    expect(
      w.findAll('[data-set="bedtime"][data-testid="chore-draft-row"]').map((r) => titleOf(r).value)
    ).toEqual(['Bubble bath']);
    expect(w.findAll('[data-set="tidy-up"][data-testid="chore-draft-row"]')).toHaveLength(5);
  });
});

describe('ChoreAddSheet: the rows', () => {
  it('the time control opens the four blocks and moves the row to that heading', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    const time = rowOf(w, 'pack-bag').get('[data-testid="chore-draft-time"]');
    expect(time.attributes('aria-expanded')).toBe('false');
    await time.trigger('click');
    expect(time.attributes('aria-expanded')).toBe('true');
    const choices = rowOf(w, 'pack-bag').findAll('[data-testid="chore-draft-time-choices"] button');
    expect(choices.map((b) => b.attributes('data-block'))).toEqual([
      'morning',
      'afternoon',
      'evening',
      'anytime',
    ]);
    await choices[2]!.trigger('click');
    expect(blockRows(w, 'evening').map((r) => r.attributes('data-chore'))).toEqual(['pack-bag']);
    expect(w.find('[data-testid="chore-draft-time-choices"]').exists()).toBe(false);
    await submit(w);
    expect(sentDrafts().find((d) => d.starterChoreKey === 'pack-bag')!.block).toBe('evening');
  });

  it('remove, the days tag, and the button counts the named rows', async () => {
    const w = await openSheet({ presetMemberIds: ['kid'] });
    await addSetVia(w, 'school-morning');
    expect(rowOf(w, 'make-bed').get('[data-testid="chore-draft-days"]').text()).toBe(
      'choreboard.form.days.school'
    );
    for (const c of school.chores.slice(1)) {
      await rowOf(w, c.key).get('[data-testid="chore-draft-remove"]').trigger('click');
    }
    expect(addButton(w).text()).toBe('choreboard.starter.cta.one');
    await w.get('[data-testid="chore-add-row"][data-block="anytime"]').trigger('click');
    await flushPromises();
    // A blank row is not counted, and a grown-up's own row is every day (no tag).
    expect(addButton(w).text()).toBe('choreboard.starter.cta.one');
    expect(blockRows(w, 'anytime')[0]!.find('[data-testid="chore-draft-days"]').exists()).toBe(
      false
    );
    await rowOf(w, 'make-bed').get('[data-testid="chore-draft-remove"]').trigger('click');
    await blockRows(w, 'anytime')[0]!.get('[data-testid="chore-draft-remove"]').trigger('click');
    expect(addButton(w).attributes('disabled')).toBeDefined();
  });

  it('an add row starts that block: focused; Enter names it and opens the next blank row', async () => {
    const w = await openSheet();
    await w.get('[data-testid="chore-add-row"][data-block="afternoon"]').trigger('click');
    await flushPromises();
    const first = blockRows(w, 'afternoon')[0]!;
    expect(document.activeElement).toBe(titleOf(first));
    const input = first.get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Play fetch');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const rows = blockRows(w, 'afternoon');
    expect(rows.map((r) => titleOf(r).value)).toEqual(['Play fetch', '']);
    expect(document.activeElement).toBe(titleOf(rows[1]!));
    // Blur on the still-empty new row drops it silently.
    await rows[1]!.get('[data-testid="chore-draft-title"]').trigger('blur');
    expect(blockRows(w, 'afternoon')).toHaveLength(1);
    await submit(w);
    expect(sentDrafts()).toEqual([
      expect.objectContaining({ title: 'Play fetch', block: 'afternoon', emoji: '🧹' }),
    ]);
    expect(sentDrafts()[0]!.setKey).toBeUndefined();
    expect(sentDrafts()[0]!.days).toBeUndefined();
  });

  it('an existing row emptied and committed gets its title back; Enter on it adds no row', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    await commitTitle(w, 'make-bed', '   ');
    expect(titleOf(rowOf(w, 'make-bed')).value).toBe(school.chores[0]!.titleKey);
    const input = rowOf(w, 'get-dressed').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue(' Get dressed fast ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(titleOf(rowOf(w, 'get-dressed')).value).toBe('Get dressed fast');
    expect(draftRows(w)).toHaveLength(school.chores.length);
  });

  it('Escape cancels an existing row’s edit, and drops a new row', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    const input = rowOf(w, 'make-bed').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Something else');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(titleOf(rowOf(w, 'make-bed')).value).toBe(school.chores[0]!.titleKey);
    expect(w.emitted('close')).toBeUndefined();

    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const fresh = blockRows(w, 'morning').at(-1)!.get('[data-testid="chore-draft-title"]');
    await fresh.trigger('focus');
    await fresh.setValue('Half typed');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-chore="added"]').exists()).toBe(false);
    expect(draftRows(w)).toHaveLength(school.chores.length);
  });
  it('Enter that confirms an IME composition neither commits nor opens a row', async () => {
    const w = await openSheet();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const input = blockRows(w, 'morning')[0]!.get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('喂狗');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    await flushPromises();
    expect(blockRows(w, 'morning')).toHaveLength(1);
    expect(document.activeElement).toBe(input.element);
    // The Enter after the composition is the real one.
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(blockRows(w, 'morning').map((r) => titleOf(r).value)).toEqual(['喂狗', '']);
  });

  it('an own row’s picture follows its title until it is picked by hand; set rows keep theirs', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    await w.get('[data-testid="chore-add-row"][data-block="anytime"]').trigger('click');
    await flushPromises();
    const own = () => blockRows(w, 'anytime')[0]!;
    const input = own().get('[data-testid="chore-draft-title"]');
    const ownEmoji = () =>
      useChoreAddDraft().rows.find((r) => r.draft.block === 'anytime')!.draft.emoji;
    const commit = async (v: string) => {
      await input.trigger('focus');
      await input.setValue(v);
      await input.trigger('blur');
      await flushPromises();
    };
    await commit('Feed the dog');
    expect(ownEmoji()).toBe('🐕');
    await commit('Brush teeth');
    expect(ownEmoji()).toBe('🪥');
    // A suggested row renamed keeps the set's picture.
    await commitTitle(w, 'make-bed', 'Feed the cat');
    await own().get('[data-testid="chore-draft-picture"]').trigger('click');
    w.findComponent(PictureStub).vm.$emit('update:emoji', '⭐');
    await commit('Feed the fish'); // picked by hand: the title no longer chooses
    expect(ownEmoji()).toBe('⭐');
    await submit(w);
    expect(sentDrafts().find((d) => d.title === 'Feed the fish')!.emoji).toBe('⭐');
    expect(sentDrafts().find((d) => d.title === 'Feed the cat')!.emoji).toBe(
      school.chores[0]!.emoji
    );
  });

  it('no match keeps the default picture', async () => {
    const w = await openSheet();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const input = blockRows(w, 'morning')[0]!.get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Feed the dog');
    await input.trigger('blur');
    await input.trigger('focus');
    await input.setValue('Say thank you');
    await input.trigger('blur');
    await submit(w);
    expect(sentDrafts()[0]!.emoji).toBe('🧹');
  });

  it('closing the sheet with a preview or a time chooser open leaves no Escape token', async () => {
    const w = await openSheet();
    expect(hasOpenEscapeLayer()).toBe(false);
    await chip(w, 'bedtime').trigger('click');
    expect(hasOpenEscapeLayer()).toBe(true);
    await w.setProps({ open: false });
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);

    await w.setProps({ open: true });
    await flushPromises();
    await addSetVia(w, 'school-morning');
    await rowOf(w, 'pack-bag').get('[data-testid="chore-draft-time"]').trigger('click');
    expect(hasOpenEscapeLayer()).toBe(true);
    await w.setProps({ open: false });
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);
  });

  it('Clear List, Remove from List or ✕ on the row with an open chooser closes it', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    const openTime = async (chore: string) => {
      await rowOf(w, chore).get('[data-testid="chore-draft-time"]').trigger('click');
      expect(hasOpenEscapeLayer()).toBe(true);
    };
    await openTime('pack-bag');
    await rowOf(w, 'pack-bag').get('[data-testid="chore-draft-remove"]').trigger('click');
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);

    await openTime('make-bed');
    await chip(w, 'school-morning').trigger('click');
    await w.get('[data-testid="chore-set-preview-remove"]').trigger('click');
    await flushPromises();
    expect(draftRows(w)).toHaveLength(0);
    expect(hasOpenEscapeLayer()).toBe(false);

    await addSetVia(w, 'bedtime');
    await openTime(bedtime.chores[0]!.key);
    await w.get('[data-testid="chore-add-clear"]').trigger('click');
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);
  });
});

describe('ChoreAddSheet: adding and the session list', () => {
  it('sends every named row in one call, with the sets used and the edit count', async () => {
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    await addSetVia(w, 'bedtime');
    await commitTitle(w, 'make-bed', 'Make the bed');
    await rowOf(w, 'shoes-on').get('[data-testid="chore-draft-remove"]').trigger('click');
    await submit(w);
    expect(choreActions.addChores).toHaveBeenCalledTimes(1);
    const [ids, drafts, actor, opts] = choreActions.addChores.mock.calls[0]!;
    expect([ids, actor]).toEqual([['kid', 'sib'], 'mom']);
    expect((drafts as StarterChoreDraft[]).length).toBe(
      school.chores.length - 1 + bedtime.chores.length
    );
    expect((drafts as StarterChoreDraft[])[0]).toMatchObject({
      title: 'Make the bed',
      setKey: 'school-morning',
      days: [1, 2, 3, 4, 5],
    });
    // One rename and one removal.
    expect(opts).toEqual({ sets: ['school-morning', 'bedtime'], edited: 2 });
    expect(toast).toHaveBeenCalledWith('success', 'choreboard.starter.added.other', undefined);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('the list survives close and reopen; a successful Add clears it', async () => {
    const w = await openSheet();
    await addSetVia(w, 'pet-care');
    await commitTitle(w, 'walk-dog', 'Walk Rex');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await flushPromises();
    expect(titleOf(rowOf(w, 'walk-dog')).value).toBe('Walk Rex');
    expect(chip(w, 'pet-care').attributes('data-on')).toBe('true');

    choreActions.addChores.mockResolvedValueOnce(null);
    await submit(w);
    // null: the store has already toasted; the list is kept and the sheet stays open.
    expect(toast).not.toHaveBeenCalled();
    expect(w.emitted('close')).toBeUndefined();
    expect(draftRows(w).length).toBe(pet.chores.length);

    await submit(w);
    expect(w.emitted('close')).toHaveLength(1);
    expect(draftRows(w)).toHaveLength(0);
    expect(chip(w, 'pet-care').attributes('data-on')).toBe('false');
  });

  it('Clear List empties it; the sign-out reset clears it too', async () => {
    const w = await openSheet();
    await addSetVia(w, 'tidy-up');
    await w.get('[data-testid="chore-add-clear"]').trigger('click');
    expect(draftRows(w)).toHaveLength(0);
    expect(chip(w, 'tidy-up').attributes('data-on')).toBe('false');
    await addSetVia(w, 'tidy-up');
    clearChoreAddDraft(); // what `resetAllAppStores` calls (pinned in resetStores.test)
    await flushPromises();
    expect(draftRows(w)).toHaveLength(0);
  });

  it('everyone already had them: an info toast', async () => {
    choreActions.addChores.mockResolvedValueOnce({ added: 0, skipped: 5 });
    const w = await openSheet();
    await addSetVia(w, 'bedtime');
    await submit(w);
    expect(toast).toHaveBeenCalledWith('info', 'choreboard.batch.nothingNew');
  });

  it('never mutates the built-in set definitions', async () => {
    const before = JSON.stringify(CHORE_STARTER_SETS);
    const w = await openSheet();
    await addSetVia(w, 'school-morning');
    await commitTitle(w, 'make-bed', 'Renamed');
    await rowOf(w, 'get-dressed').get('[data-testid="chore-draft-time"]').trigger('click');
    await rowOf(w, 'get-dressed')
      .findAll('[data-testid="chore-draft-time-choices"] button')[3]!
      .trigger('click');
    await rowOf(w, 'brush-teeth').get('[data-testid="chore-draft-picture"]').trigger('click');
    w.findComponent(PictureStub).vm.$emit('update:emoji', '🦷');
    await rowOf(w, 'eat-breakfast').get('[data-testid="chore-draft-remove"]').trigger('click');
    await submit(w);
    expect(JSON.stringify(CHORE_STARTER_SETS)).toBe(before);
  });
});
