/**
 * A bean's chore list, "Pip's Chores" (#146, owner decision 2026-11-13): every chore of the
 * bean's on every day, edited like a Beanie List with changes saved as they are made. Each row
 * intent is one store action with the grown-up as `actorId` and `via: 'bean-editor'`; a failed
 * write leaves the stored value showing; a new row is created when its title is committed (with
 * the parents switch's state and an automatic picture); a set adds for this bean only, skipping
 * what the bean has; ✕ takes a shared chore off this bean only; Remove All asks once; the parents
 * switch reads and writes the whole list; drag reorders a block; kids never see it; no chooser
 * leaves an Escape token behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type Stubs, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({ showToast: toast }));
const confirmFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn }));

import ChoreBeanEditor from '../ChoreBeanEditor.vue';
import { escapeLayerCount, hasOpenEscapeLayer } from '@/composables/useEscapeClose';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { chore, choreActions, chores, family, resetKit } from './choreTestKit';
import { choreStarterSet } from '@/constants/choreStarterSets';
import type { Chore } from '@/types/models';

const PictureStub = defineComponent({
  props: { emoji: String, illustration: String },
  emits: ['pick'],
  template: '<div data-testid="picture-stub" />',
});
const NotifyStub = defineComponent({
  name: 'NotifyParentsToggle',
  props: { modelValue: Boolean, testid: String },
  emits: ['update:modelValue'],
  template:
    '<button :data-testid="testid" :data-on="modelValue ? \'true\' : \'false\'" @click="$emit(\'update:modelValue\', !modelValue)" />',
});
/** vuedraggable without Sortable: renders `#item` per element and lets a test drive a move. */
const DraggableStub = defineComponent({
  name: 'Draggable',
  props: { modelValue: { type: Array, default: () => [] }, handle: String },
  emits: ['update:modelValue', 'change'],
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'ul',
        { 'data-testid': attrs['data-testid'], 'data-block': attrs['data-block'] },
        props.modelValue.map((element) => slots.item?.({ element }))
      );
  },
});

/** `BaseSidePanel`, inline: the drawer's header, body and footer while open. */
const DrawerStub = defineComponent({
  name: 'BaseSidePanel',
  props: { open: Boolean, size: String, layer: String, closable: Boolean, customHeader: Boolean },
  template:
    '<div v-if="open" data-testid="drawer-stub" :data-size="size"><h1 data-testid="modal-title"><slot name="header" /></h1><slot /><slot name="footer" /></div>',
});

const stubs = {
  // The drawer's panel, without its Teleport and Escape token (a describe below mounts the real
  // one for the Escape layers); BeanieFormModal itself is real, so its Done/Add button is.
  BaseSidePanel: DrawerStub,
  ModalIconTitle: { template: '<span><slot /></span>' },
  FormFieldGroup: {
    props: ['label'],
    template: '<div :data-label="label"><slot name="label-extra" /><slot /></div>',
  },
  ChorePicturePicker: PictureStub,
  NotifyParentsToggle: NotifyStub,
  CardArt: true,
  draggable: DraggableStub,
};

const VIA = { via: 'bean-editor' };

const mounted: VueWrapper[] = [];
async function openEditor(memberId = 'kid', globalStubs: Stubs = stubs): Promise<VueWrapper> {
  const w = mount(ChoreBeanEditor, {
    props: { open: false, memberId },
    global: { stubs: globalStubs },
    attachTo: document.body,
  });
  mounted.push(w);
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

const rows = (w: VueWrapper) => w.findAll('[data-testid="chore-draft-row"]');
const rowOf = (w: VueWrapper, id: string) =>
  w.get(`[data-testid="chore-draft-row"][data-chore-id="${id}"]`);
const titleOf = (r: { get: VueWrapper['get'] }) =>
  r.get('[data-testid="chore-draft-title"]').element as HTMLTextAreaElement;
const blockRows = (w: VueWrapper, b: string) =>
  w.findAll(`[data-testid="chore-draft-row"][data-block="${b}"]`);

async function typeTitle(r: { get: VueWrapper['get'] }, value: string, how: 'blur' | 'enter') {
  const input = r.get('[data-testid="chore-draft-title"]');
  await input.trigger('focus');
  await input.setValue(value);
  if (how === 'enter') await input.trigger('keydown', { key: 'Enter' });
  else await input.trigger('blur');
  await flushPromises();
}

/** The fake store's update: what a landed write does (the re-read changes the chore). */
function updateLands(): void {
  choreActions.updateChore.mockImplementation(
    async (id: string, patch: Partial<Chore> & { days?: number[] }) => {
      const c = chores.list.find((x) => x.id === id)!;
      Object.assign(c, patch, patch.days && !patch.days.length ? { days: undefined } : {});
      return c;
    }
  );
}

beforeEach(() => {
  resetKit();
  toast.mockReset();
  confirmFn.mockReset();
  chores.list = [
    chore('k1', { title: 'Make bed', sortOrder: 0 }),
    chore('k2', { title: 'Brush teeth', block: 'evening', sortOrder: 1 }),
    // Not today (a Friday): still in Pip's list, with its tag.
    chore('sat', { title: 'Wash the car', block: 'afternoon', days: [6], sortOrder: 2 }),
    chore('sh', { title: 'Feed the dog', assigneeIds: ['kid', 'sib'], sortOrder: 3 }),
    chore('s1', { title: 'Juno only', assigneeIds: ['sib'], sortOrder: 4 }),
  ];
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe('ChoreBeanEditor: opening', () => {
  it('"{name}\'s Chores": every chore of the bean, every day, by time of day; no people picker', async () => {
    const w = await openEditor();
    expect(w.get('[data-testid="modal-title"]').text()).toBe('choreboard.editor.title');
    expect(rows(w).map((r) => r.attributes('data-chore-id'))).toEqual(['k1', 'sh', 'sat', 'k2']);
    expect(blockRows(w, 'afternoon')[0]!.get('[data-testid="chore-draft-days"]').text()).toBe(
      'planner.day.sat'
    );
    // An every-day chore shows only the quiet calendar control.
    expect(rowOf(w, 'k1').find('[data-testid="chore-draft-days"]').exists()).toBe(false);
    expect(rowOf(w, 'k1').find('[data-testid="chore-draft-days-pick"]').exists()).toBe(true);
    // A chore shared with Juno says so; Juno's own chore is not here.
    expect(rowOf(w, 'sh').get('[data-testid="chore-draft-note"]').text()).toBe(
      'choreboard.editor.sharedWith'
    );
    expect(w.find('[data-chore-id="s1"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-starter-who-refused"]').exists()).toBe(false);
    // No save button: changes save as they are made; Done closes.
    expect(w.find('[data-testid="chore-starter-add"]').exists()).toBe(false);
    await w.get('[data-testid="chore-bean-editor-done"]').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('is the right-hand drawer, like a list: hint, sets, the list, then Keep Parents Posted', async () => {
    const w = await openEditor();
    const drawer = w.findComponent(BeanieFormModal);
    expect(drawer.props()).toMatchObject({
      variant: 'drawer',
      size: 'narrow',
      saveLabel: 'action.done',
    });
    expect(w.get('[data-testid="drawer-stub"]').attributes('data-size')).toBe('narrow');
    // Top to bottom: the hint, the sets, the list (with Remove All in its header), the switch.
    const order = [
      '[data-testid="chore-bean-editor-hint"]',
      '[data-testid="chore-suggest-chip"]',
      '[data-label="choreboard.editor.list"]',
      '[data-testid="chore-bean-editor-remove-all"]',
      '[data-testid="chore-draft-row"]',
      '[data-testid="chore-bean-editor-notify-parents"]',
    ].map((sel) => w.get(sel).element);
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!;
      const pos = prev.compareDocumentPosition(order[i]!);
      expect(
        pos & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)
      ).toBeTruthy();
    }
    // The switch is the body's last block, after the whole list.
    const body = w.get('[data-testid="chore-bean-editor"]').element;
    expect(body.lastElementChild?.getAttribute('data-testid')).toBe(
      'chore-bean-editor-notify-parents'
    );
  });

  it('a child viewer never sees it, even if asked to open it', async () => {
    family.currentMemberId = 'kid';
    const w = await openEditor();
    expect(w.find('[data-testid="chore-bean-editor"]').exists()).toBe(false);
  });
});

describe('ChoreBeanEditor: rows save as they change', () => {
  it('a rename saves on blur and on Enter; unchanged writes nothing; Escape cancels', async () => {
    updateLands();
    const w = await openEditor();
    await typeTitle(rowOf(w, 'k1'), '  Make the bed  ', 'blur');
    expect(choreActions.updateChore).toHaveBeenCalledWith(
      'k1',
      { title: 'Make the bed' },
      'mom',
      VIA
    );
    expect(titleOf(rowOf(w, 'k1')).value).toBe('Make the bed');
    await typeTitle(rowOf(w, 'k2'), 'Brush teeth', 'enter');
    expect(choreActions.updateChore).toHaveBeenCalledTimes(1);
    const input = rowOf(w, 'k2').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Something else');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(titleOf(rowOf(w, 'k2')).value).toBe('Brush teeth');
    expect(choreActions.updateChore).toHaveBeenCalledTimes(1);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('a failed write shows the stored title again (the store has toasted); nothing is left', async () => {
    choreActions.updateChore.mockResolvedValueOnce(null);
    const w = await openEditor();
    await typeTitle(rowOf(w, 'k1'), 'Never saved', 'blur');
    expect(titleOf(rowOf(w, 'k1')).value).toBe('Make bed');
    expect(toast).not.toHaveBeenCalled();
    // An emptied title is no write and keeps the name.
    await typeTitle(rowOf(w, 'k1'), '   ', 'blur');
    expect(choreActions.updateChore).toHaveBeenCalledTimes(1);
    expect(titleOf(rowOf(w, 'k1')).value).toBe('Make bed');
  });

  it('time, picture and days each write the one field', async () => {
    updateLands();
    const w = await openEditor();
    await rowOf(w, 'k1').get('[data-testid="chore-draft-time"]').trigger('click');
    await rowOf(w, 'k1')
      .get('[data-testid="chore-draft-time-choices"] [data-block="evening"]')
      .trigger('click');
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenLastCalledWith(
      'k1',
      { block: 'evening' },
      'mom',
      VIA
    );
    expect(blockRows(w, 'evening').map((r) => r.attributes('data-chore-id'))).toEqual(['k1', 'k2']);

    await rowOf(w, 'k2').get('[data-testid="chore-draft-picture"]').trigger('click');
    w.findComponent(PictureStub).vm.$emit('pick', { emoji: '🦷', illustration: '' });
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenLastCalledWith(
      'k2',
      { emoji: '🦷', illustration: undefined },
      'mom',
      VIA
    );

    // Every day → School Days: the chooser closes and the tag takes the control's place.
    await rowOf(w, 'k2').get('[data-testid="chore-draft-days-pick"]').trigger('click');
    await rowOf(w, 'k2')
      .get('[data-testid="chore-draft-days-choices"] [data-mode="school"] button')
      .trigger('click');
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenLastCalledWith(
      'k2',
      { days: [1, 2, 3, 4, 5] },
      'mom',
      VIA
    );
    expect(rowOf(w, 'k2').find('[data-testid="chore-draft-days-choices"]').exists()).toBe(false);
    expect(rowOf(w, 'k2').get('[data-testid="chore-draft-days"]').text()).toBe(
      'choreboard.form.days.school'
    );
    // The tag reopens it; Pick Days turns a day off; Every Day clears them.
    await rowOf(w, 'k2').get('[data-testid="chore-draft-days"]').trigger('click');
    await rowOf(w, 'k2').get('[data-mode="pick"] button').trigger('click');
    const toggles = rowOf(w, 'k2').findAll('[data-testid="chore-draft-days-toggles"] button');
    await toggles[0]!.trigger('click'); // Monday off
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenLastCalledWith(
      'k2',
      { days: [2, 3, 4, 5] },
      'mom',
      VIA
    );
    await rowOf(w, 'k2').get('[data-mode="every"] button').trigger('click');
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenLastCalledWith('k2', { days: [] }, 'mom', VIA);
    expect(rowOf(w, 'k2').find('[data-testid="chore-draft-days"]').exists()).toBe(false);
  });

  it('a renamed or moved shared chore changes for everyone; its ✕ takes it off this bean only', async () => {
    choreActions.removeChoresForMember.mockResolvedValue({ deleted: 0, unassigned: 1 });
    const w = await openEditor();
    await typeTitle(rowOf(w, 'sh'), 'Feed Rex', 'blur');
    expect(choreActions.updateChore).toHaveBeenCalledWith('sh', { title: 'Feed Rex' }, 'mom', VIA);
    await rowOf(w, 'sh').get('[data-testid="chore-draft-remove"]').trigger('click');
    await flushPromises();
    expect(choreActions.removeChoresForMember).toHaveBeenCalledWith(['sh'], 'kid', 'mom', VIA);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it('a ✕ that fails puts the row back', async () => {
    let settle: (v: null) => void = () => {};
    choreActions.removeChoresForMember.mockReturnValueOnce(
      new Promise((r) => {
        settle = r;
      })
    );
    const w = await openEditor();
    await rowOf(w, 'k1').get('[data-testid="chore-draft-remove"]').trigger('click');
    await flushPromises();
    // Gone at once, while the write is in flight.
    expect(w.find('[data-chore-id="k1"]').exists()).toBe(false);
    settle(null);
    await flushPromises();
    expect(w.find('[data-chore-id="k1"]').exists()).toBe(true);
  });
});

describe('ChoreBeanEditor: an edit in progress', () => {
  it('✕ on a shared chore mid-rename discards the rename (blur towards the ✕ first)', async () => {
    choreActions.removeChoresForMember.mockResolvedValue({ deleted: 0, unassigned: 1 });
    const w = await openEditor();
    const input = rowOf(w, 'sh').get('[data-testid="chore-draft-title"]');
    const remove = rowOf(w, 'sh').get('[data-testid="chore-draft-remove"]');
    await input.trigger('focus');
    await input.setValue('Feed the d');
    await input.trigger('blur', { relatedTarget: remove.element });
    await remove.trigger('click');
    await flushPromises();
    expect(choreActions.updateChore).not.toHaveBeenCalled();
    expect(choreActions.removeChoresForMember).toHaveBeenCalledWith(['sh'], 'kid', 'mom', VIA);
  });

  it('✕ with the field still focused discards the rename, and the row leaving commits nothing', async () => {
    choreActions.removeChoresForMember.mockImplementation(async () => {
      chores.list = chores.list.filter((c) => c.id !== 'sh');
      return { deleted: 0, unassigned: 1 };
    });
    const w = await openEditor();
    const input = rowOf(w, 'sh').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Feed the d');
    await rowOf(w, 'sh').get('[data-testid="chore-draft-remove"]').trigger('click');
    await flushPromises();
    // The row has left (unmounted): no commit on the way out.
    expect(w.find('[data-chore-id="sh"]').exists()).toBe(false);
    expect(choreActions.updateChore).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('Escape that ends an IME composition keeps the edit', async () => {
    updateLands();
    const w = await openEditor();
    const input = rowOf(w, 'k1').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('整理床铺');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));
    await flushPromises();
    expect(titleOf(rowOf(w, 'k1')).value).toBe('整理床铺');
    await input.trigger('blur');
    await flushPromises();
    expect(choreActions.updateChore).toHaveBeenCalledWith('k1', { title: '整理床铺' }, 'mom', VIA);
  });
});

describe('ChoreBeanEditor: adding', () => {
  /** The store's create: what a landed write does, under the id the editor minted. */
  function createLands(): void {
    choreActions.createChore.mockImplementation(
      async (d: Chore, _actor: string, o: { id: string }) => {
        const c = chore(o.id, { ...d, sortOrder: 9 });
        chores.list = [...chores.list, c];
        return c;
      }
    );
  }
  const createdId = (n = 0) => (choreActions.createChore.mock.calls[n]![2] as { id: string }).id;

  it('a new row is created when its title is committed: this bean, an automatic picture, Enter opens the next', async () => {
    createLands();
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="anytime"]').trigger('click');
    await flushPromises();
    const fresh = blockRows(w, 'anytime')[0]!;
    expect(document.activeElement).toBe(titleOf(fresh));
    await typeTitle(fresh, 'Feed the dog', 'enter');
    expect(choreActions.createChore).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Feed the dog',
        emoji: '🐕',
        assigneeIds: ['kid'],
        block: 'anytime',
        // Pip has chores: the store decides Keep Parents Posted from them.
        notifyParents: undefined,
      }),
      'mom',
      { via: 'bean-editor', id: expect.any(String) }
    );
    // The stored chore took the row's place, and a blank row waits under it.
    const anytime = blockRows(w, 'anytime');
    expect(anytime.map((r) => r.attributes('data-chore-id'))).toEqual([createdId(), 'new']);
    expect(document.activeElement).toBe(titleOf(anytime[1]!));
    // Left empty, the blank row goes without a write.
    await anytime[1]!.get('[data-testid="chore-draft-title"]').trigger('blur');
    await flushPromises();
    expect(w.find('[data-chore-id="new"]').exists()).toBe(false);
    expect(choreActions.createChore).toHaveBeenCalledTimes(1);
  });

  it('a new row whose create fails is dropped (the store has toasted); a picked picture is kept', async () => {
    choreActions.createChore.mockResolvedValueOnce(null);
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const fresh = () => w.get('[data-chore-id="new"]');
    await fresh().get('[data-testid="chore-draft-picture"]').trigger('click');
    w.findComponent(PictureStub).vm.$emit('pick', { emoji: '⭐', illustration: 'trash' });
    await flushPromises();
    await typeTitle(fresh(), 'Feed the dog', 'enter');
    expect(choreActions.createChore).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: '⭐', illustration: 'trash' }),
      'mom',
      expect.objectContaining({ via: 'bean-editor' })
    );
    expect(w.find('[data-chore-id="new"]').exists()).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('the row keeps its key while its create is in flight: a chooser stays open and a pick made meanwhile is saved after', async () => {
    let land: () => void = () => {};
    choreActions.createChore.mockImplementation(
      (d: Chore, _a: string, o: { id: string }) =>
        new Promise((resolve) => {
          land = () => {
            const c = chore(o.id, { ...d, sortOrder: 9 });
            chores.list = [...chores.list, c];
            resolve(c);
          };
        })
    );
    updateLands();
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="evening"]').trigger('click');
    await flushPromises();
    await typeTitle(blockRows(w, 'evening').at(-1)!, 'Feed the cat', 'blur');
    expect(choreActions.createChore).toHaveBeenCalledTimes(1);
    const row = () => w.get('[data-testid="chore-draft-row"][data-chore-id="new"]');
    // In flight: School Days, then the picture chooser left open.
    await row().get('[data-testid="chore-draft-days-pick"]').trigger('click');
    await row().get('[data-mode="school"] button').trigger('click');
    await row().get('[data-testid="chore-draft-picture"]').trigger('click');
    expect(w.find('[data-testid="picture-stub"]').exists()).toBe(true);
    land();
    await flushPromises();
    const id = createdId();
    expect(w.find(`[data-chore-id="${id}"]`).exists()).toBe(true);
    // The same row (its key kept), so its chooser is still open.
    expect(w.find('[data-testid="picture-stub"]').exists()).toBe(true);
    expect(hasOpenEscapeLayer()).toBe(true);
    expect(choreActions.updateChore).toHaveBeenCalledWith(
      id,
      { days: [1, 2, 3, 4, 5] },
      'mom',
      VIA
    );
  });

  it('closing the editor the page’s way (open off, bean cleared) mid-typing still creates the chore', async () => {
    createLands();
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const input = w.get('[data-chore-id="new"] [data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Water the plants');
    // No blur: the page sets `open` false and clears the bean together.
    await w.setProps({ open: false, memberId: null });
    await flushPromises();
    expect(choreActions.createChore).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Water the plants', assigneeIds: ['kid'] }),
      'mom',
      expect.objectContaining({ via: 'bean-editor' })
    );
  });

  it('a set adds this bean’s missing chores in one call; what the bean has is dimmed and skipped', async () => {
    const school = choreStarterSet('school-morning')!;
    // The fake t returns the key, so Pip "already has" the set's first chore by that title.
    chores.list = [
      ...chores.list,
      chore('mb', { title: school.chores[0]!.titleKey, sortOrder: 5 }),
    ];
    choreActions.addChores.mockResolvedValue({ added: school.chores.length - 1, skipped: 0 });
    const w = await openEditor();
    await w.get('[data-testid="chore-suggest-chip"][data-set="school-morning"]').trigger('click');
    expect(w.findAll('[data-testid="chore-set-preview-row"][data-dup="true"]')).toHaveLength(1);
    // A bean's list has nothing to take back: no Remove from List.
    expect(w.find('[data-testid="chore-set-preview-remove"]').exists()).toBe(false);
    await w.get('[data-testid="chore-set-preview-add"]').trigger('click');
    await flushPromises();
    expect(choreActions.addChores).toHaveBeenCalledTimes(1);
    const [ids, drafts, actor, opts] = choreActions.addChores.mock.calls[0]!;
    expect([ids, actor]).toEqual([['kid'], 'mom']);
    expect((drafts as { title: string }[]).map((d) => d.title)).toEqual(
      school.chores.slice(1).map((c) => c.titleKey)
    );
    // Pip has chores: the store decides Keep Parents Posted (no override from here).
    expect(opts).toEqual({ sets: ['school-morning'], via: 'bean-editor' });
    expect(toast).toHaveBeenCalledWith('success', 'choreboard.starter.added.other', undefined);
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
  });
});

describe('ChoreBeanEditor: a create in flight', () => {
  /** A create that lands only when the test says so. */
  function heldCreate(): { land: () => void } {
    const held = { land: () => {} };
    choreActions.createChore.mockImplementation(
      (d: Chore, _a: string, o: { id: string }) =>
        new Promise((resolve) => {
          held.land = () => {
            const c = chore(o.id, { ...d, sortOrder: 9 });
            chores.list = [...chores.list, c];
            resolve(c);
          };
        })
    );
    return held;
  }

  it('the row key is the chore id from the start; a time move in flight is kept, the row never remounts as it settles', async () => {
    const held = heldCreate();
    updateLands();
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    const input = () => w.get('[data-chore-id="new"] [data-testid="chore-draft-title"]');
    await input().trigger('focus');
    await input().setValue('Feed the cat');
    await input().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const id = (choreActions.createChore.mock.calls[0]![2] as { id: string }).id;
    // In flight: move it to the evening and focus its title again.
    await w.get('[data-chore-id="new"] [data-testid="chore-draft-time"]').trigger('click');
    await w.get('[data-chore-id="new"] [data-block="evening"][aria-pressed]').trigger('click');
    await flushPromises();
    const moved = w.get(
      '[data-chore-id="new"][data-block="evening"] [data-testid="chore-draft-title"]'
    );
    (moved.element as HTMLTextAreaElement).focus();
    const movedField = moved.element;
    held.land();
    await flushPromises();
    // Settled: now the stored chore; the move was saved after.
    const row = w.get(`[data-chore-id="${id}"]`);
    expect(row.attributes('data-block')).toBe('evening');
    // The same textarea (the row never remounted as it settled).
    expect(row.get('[data-testid="chore-draft-title"]').element).toBe(movedField);
    expect(choreActions.updateChore).toHaveBeenCalledWith(id, { block: 'evening' }, 'mom', VIA);
    // Enter opened the next blank row in the row's CURRENT block (evening), focused.
    const next = w.findAll('[data-chore-id="new"]');
    expect(next.map((r) => r.attributes('data-block'))).toEqual(['evening']);
    expect(document.activeElement).toBe(next[0]!.get('[data-testid="chore-draft-title"]').element);
  });

  it('Enter opens no next row when the editor has moved on to another bean', async () => {
    const held = heldCreate();
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    await typeTitle(w.get('[data-chore-id="new"]'), 'Feed the cat', 'enter');
    await w.setProps({ memberId: 'sib' });
    await flushPromises();
    held.land();
    await flushPromises();
    expect(choreActions.createChore).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeIds: ['kid'] }),
      'mom',
      expect.anything()
    );
    expect(w.find('[data-chore-id="new"]').exists()).toBe(false);
  });

  it('a parents toggle made during a bean’s first create is applied once it lands', async () => {
    chores.list = [];
    const held = heldCreate();
    choreActions.setNotifyParentsFor.mockResolvedValue({ count: 1 });
    const w = await openEditor();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    await typeTitle(w.get('[data-chore-id="new"]'), 'Make bed', 'blur');
    expect(choreActions.createChore.mock.calls[0]![0]).toMatchObject({ notifyParents: false });
    await w.get('[data-testid="chore-bean-editor-notify-parents"]').trigger('click');
    held.land();
    await flushPromises();
    expect(choreActions.setNotifyParentsFor).toHaveBeenCalledWith('kid', true, 'mom', VIA);
  });
});

describe('ChoreBeanEditor: the switch only moves when touched', () => {
  it('on, then Remove All, then a set: the new chores are still flagged', async () => {
    for (const c of chores.list) c.notifyParents = true;
    choreActions.removeChoresForMember.mockImplementation(async (ids: string[]) => {
      chores.list = chores.list.filter((c) => !ids.includes(c.id) || c.id === 's1');
      return { deleted: ids.length, unassigned: 0 };
    });
    choreActions.addChores.mockResolvedValue({ added: 6, skipped: 0 });
    confirmFn.mockResolvedValue(true);
    const w = await openEditor();
    const sw = () => w.get('[data-testid="chore-bean-editor-notify-parents"]');
    expect(sw().attributes('data-on')).toBe('true');
    await w.get('[data-testid="chore-bean-editor-remove-all"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="chore-draft-row"]').exists()).toBe(false);
    expect(sw().attributes('data-on')).toBe('true');
    await w.get('[data-testid="chore-suggest-chip"][data-set="school-morning"]').trigger('click');
    await w.get('[data-testid="chore-set-preview-add"]').trigger('click');
    await flushPromises();
    expect(choreActions.addChores.mock.calls[0]![3]).toMatchObject({ notifyParents: true });
  });

  it('opened with no bean, it shows nothing (never the previous bean’s list)', async () => {
    const w = await openEditor();
    await w.setProps({ open: false });
    await w.setProps({ open: true, memberId: null });
    await flushPromises();
    expect(w.find('[data-testid="chore-bean-editor"]').exists()).toBe(false);
  });
});

describe('ChoreBeanEditor: Remove All and reorder', () => {
  it('Remove All asks once (danger), then removes every chore here for this bean', async () => {
    choreActions.removeChoresForMember.mockResolvedValue({ deleted: 3, unassigned: 1 });
    const w = await openEditor();
    confirmFn.mockResolvedValueOnce(false);
    await w.get('[data-testid="chore-bean-editor-remove-all"]').trigger('click');
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'choreboard.editor.removeAll.title', variant: 'danger' })
    );
    expect(choreActions.removeChoresForMember).not.toHaveBeenCalled();
    confirmFn.mockResolvedValueOnce(true);
    await w.get('[data-testid="chore-bean-editor-remove-all"]').trigger('click');
    await flushPromises();
    const [ids, bean, actor, opts] = choreActions.removeChoresForMember.mock.calls[0]!;
    expect([...(ids as string[])].sort()).toEqual(['k1', 'k2', 'sat', 'sh']);
    expect([bean, actor, opts]).toEqual(['kid', 'mom', VIA]);
  });

  it('a drag within a block reorders through the store; one that does not land is put back', async () => {
    chores.list = [
      chore('a', { title: 'A', sortOrder: 0 }),
      chore('b', { title: 'B', sortOrder: 1 }),
    ];
    const w = await openEditor();
    expect(rowOf(w, 'a').find('[data-testid="chore-drag-handle"]').exists()).toBe(true);
    const drag = w.findComponent(DraggableStub);
    const [a, b] = drag.props('modelValue') as unknown[];
    choreActions.reorderChores.mockResolvedValueOnce(null);
    await drag.vm.$emit('update:modelValue', [b, a]);
    await drag.vm.$emit('change', { moved: { oldIndex: 1, newIndex: 0 } });
    await flushPromises();
    expect(choreActions.reorderChores).toHaveBeenCalledWith(['b', 'a'], 'mom', VIA);
    expect(drag.props('modelValue')).toEqual([a, b]);
  });
});

describe('ChoreBeanEditor: Keep Parents Posted, for the whole list', () => {
  it('a child’s list: on when every chore has it; switching writes all of them in one call', async () => {
    choreActions.setNotifyParentsFor.mockResolvedValue({ count: 3 });
    const w = await openEditor();
    const sw = () => w.get('[data-testid="chore-bean-editor-notify-parents"]');
    expect(sw().attributes('data-on')).toBe('false');
    await sw().trigger('click');
    await flushPromises();
    expect(choreActions.setNotifyParentsFor).toHaveBeenCalledWith('kid', true, 'mom', VIA);
    // Every chore flagged reads as on.
    for (const c of chores.list) c.notifyParents = true;
    await flushPromises();
    expect(sw().attributes('data-on')).toBe('true');
  });

  it('with no chores yet the choice waits for the new ones, and they take it', async () => {
    chores.list = [];
    choreActions.createChore.mockResolvedValue(null);
    const w = await openEditor();
    await w.get('[data-testid="chore-bean-editor-notify-parents"]').trigger('click');
    await flushPromises();
    expect(choreActions.setNotifyParentsFor).not.toHaveBeenCalled();
    await w.get('[data-testid="chore-add-row"][data-block="morning"]').trigger('click');
    await flushPromises();
    await typeTitle(w.get('[data-chore-id="new"]'), 'Make bed', 'blur');
    expect(choreActions.createChore).toHaveBeenCalledWith(
      expect.objectContaining({ notifyParents: true }),
      'mom',
      expect.objectContaining({ via: 'bean-editor' })
    );
  });

  it('a grown-up’s list has no parents switch', async () => {
    const w = await openEditor('dad');
    expect(w.find('[data-testid="chore-bean-editor-notify-parents"]').exists()).toBe(false);
  });
});

describe('ChoreBeanEditor: Escape layers', () => {
  it('closing with a chooser or a preview open leaves no Escape token; so does a row leaving', async () => {
    const w = await openEditor();
    expect(hasOpenEscapeLayer()).toBe(false);
    await rowOf(w, 'k1').get('[data-testid="chore-draft-days-pick"]').trigger('click');
    expect(hasOpenEscapeLayer()).toBe(true);
    await w.setProps({ open: false });
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);

    await w.setProps({ open: true });
    await flushPromises();
    await w.get('[data-testid="chore-suggest-chip"][data-set="bedtime"]').trigger('click');
    expect(hasOpenEscapeLayer()).toBe(true);
    await w.setProps({ open: false });
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);

    await w.setProps({ open: true });
    await flushPromises();
    await rowOf(w, 'k2').get('[data-testid="chore-draft-time"]').trigger('click');
    expect(hasOpenEscapeLayer()).toBe(true);
    // Deleted on another device: the row leaves, its chooser with it.
    chores.list = chores.list.filter((c) => c.id !== 'k2');
    await flushPromises();
    expect(hasOpenEscapeLayer()).toBe(false);
  });
});

describe('ChoreBeanEditor: the real drawer', () => {
  // The real `BaseSidePanel` (its Teleport inlined), so its own Escape token is in the stack.
  const realDrawer = { ...stubs, BaseSidePanel: false, teleport: true };

  it('Escape closes an open chooser first, then the drawer; closing releases every token', async () => {
    const w = await openEditor('kid', realDrawer);
    expect(escapeLayerCount()).toBe(1); // the drawer
    await rowOf(w, 'k1').get('[data-testid="chore-draft-days-pick"]').trigger('click');
    expect(escapeLayerCount()).toBe(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-testid="chore-draft-days-choices"]').exists()).toBe(false);
    expect(w.emitted('close')).toBeUndefined();
    expect(escapeLayerCount()).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toHaveLength(1);

    // The page's close: the body unmounts, so a chooser left open goes with the drawer.
    await rowOf(w, 'k1').get('[data-testid="chore-draft-days-pick"]').trigger('click');
    expect(escapeLayerCount()).toBe(2);
    await w.setProps({ open: false, memberId: null });
    await flushPromises();
    expect(w.find('[data-testid="chore-bean-editor"]').exists()).toBe(false);
    expect(hasOpenEscapeLayer()).toBe(false);
  });

  it('a row edit and a set preview each take Escape before the drawer; Done closes it', async () => {
    const w = await openEditor('kid', realDrawer);
    const input = rowOf(w, 'k2').get('[data-testid="chore-draft-title"]');
    await input.trigger('focus');
    await input.setValue('Something else');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(titleOf(rowOf(w, 'k2')).value).toBe('Brush teeth');
    expect(w.emitted('close')).toBeUndefined();
    expect(escapeLayerCount()).toBe(1);

    await w.get('[data-testid="chore-suggest-chip"][data-set="bedtime"]').trigger('click');
    expect(escapeLayerCount()).toBe(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.find('[data-testid="chore-set-preview"]').exists()).toBe(false);
    expect(w.emitted('close')).toBeUndefined();
    await w.get('[data-testid="chore-bean-editor-done"]').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
  });
});
