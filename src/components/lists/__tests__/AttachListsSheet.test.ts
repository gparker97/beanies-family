/**
 * AttachListsSheet: pick lists the family already has and attach them to a trip or an activity
 * session in one write. What it must guarantee:
 *   - only the store's attachable lists are offered, filtered by the search,
 *   - several can be picked; Attach is disabled with none, and a pick that stops being
 *     attachable (linked elsewhere on another device) no longer counts,
 *   - one `attachLists` write; success emits `attached(count, partial)` and closes; failure
 *     emits `failed` and keeps the sheet and the pick for a retry (the store already toasted),
 *   - a double tap writes once; search and pick reset each time it opens,
 *   - the "move it from its Link row" note is always shown.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList } from '@/types/models';
import type { ListLinkTarget } from '@/utils/activityLinks';

const h = vi.hoisted(() => ({
  attachableLists: vi.fn(),
  attachLists: vi.fn(),
}));

vi.mock('@/stores/listStore', async () => {
  const { reactive: r } = await import('vue');
  const store = r({
    // Read through a getter so a test can change the candidates and see the sheet react.
    attachableLists: (kind: string) => h.attachableLists(kind),
    attachLists: (...a: unknown[]) => h.attachLists(...a),
  });
  return { useListStore: () => store };
});
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import AttachListsSheet from '../AttachListsSheet.vue';

// The modal shell: its save button and close, and the body.
const ModalStub = defineComponent({
  name: 'BeanieFormModal',
  props: ['open', 'title', 'saveLabel', 'saveDisabled', 'isSubmitting', 'layer'],
  emits: ['save', 'close'],
  template: `<div v-if="open"><slot /><button data-testid="save" :disabled="saveDisabled" @click="$emit('save')">{{ saveLabel }}</button></div>`,
});
const RowStub = defineComponent({
  name: 'ListChoiceRow',
  props: ['list', 'selectable', 'selected'],
  template: `<button data-testid="row" :data-id="list.id" :aria-pressed="selected">{{ list.title }}</button>`,
});
const InputStub = defineComponent({
  name: 'BaseInput',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<input data-testid="search" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
});

const TRIP: ListLinkTarget = { kind: 'trip', vacationId: 'trip-1' };
const list = (id: string, title = id) => ({ id, title }) as FamilyList;

// Shared reactive candidates, so a test can make one drop out while the sheet is open.
const candidates = reactive<{ value: FamilyList[] }>({ value: [] });

function mountSheet(props: Partial<{ open: boolean; stacked: boolean }> = {}) {
  return mount(AttachListsSheet, {
    props: { open: false, target: TRIP, ...props },
    global: {
      stubs: { BeanieFormModal: ModalStub, ListChoiceRow: RowStub, BaseInput: InputStub },
    },
  });
}

/** Mount closed, then open: the reset runs on the open transition, as in the app. */
async function openSheet(props: Partial<{ stacked: boolean }> = {}) {
  const w = mountSheet(props);
  await w.setProps({ open: true });
  return w;
}

const rows = (w: ReturnType<typeof mountSheet>) => w.findAll('[data-testid="row"]');
const save = (w: ReturnType<typeof mountSheet>) => w.find('[data-testid="save"]');

beforeEach(() => {
  vi.clearAllMocks();
  candidates.value = [list('a', 'Packing'), list('b', 'Snacks'), list('c', 'Pharmacy')];
  h.attachableLists.mockImplementation(() => candidates.value);
  h.attachLists.mockImplementation(async (ids: string[]) => ids.map((id) => list(id)));
});

describe('AttachListsSheet', () => {
  it('offers the attachable lists for the target kind, Attach disabled until one is picked', async () => {
    const w = await openSheet();
    expect(h.attachableLists).toHaveBeenCalledWith('trip');
    expect(rows(w).map((r) => r.attributes('data-id'))).toEqual(['a', 'b', 'c']);
    expect(save(w).attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('linkedLists.attachNote');
  });

  it('filters by the search, keeping a pick hidden by it', async () => {
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await w.find('[data-testid="search"]').setValue('snack');
    expect(rows(w).map((r) => r.attributes('data-id'))).toEqual(['b']);
    await w.find('[data-testid="search"]').setValue('zzz');
    expect(w.find('[data-testid="attach-lists-no-match"]').exists()).toBe(true);
    expect(save(w).attributes('disabled')).toBeUndefined(); // 'a' still picked
  });

  it('shows the empty state (and the note) when nothing can be attached', async () => {
    candidates.value = [];
    const w = await openSheet();
    expect(w.find('[data-testid="attach-lists-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="search"]').exists()).toBe(false);
    expect(w.text()).toContain('linkedLists.attachNote');
  });

  it('attaches the picked lists in one write, then reports and closes', async () => {
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await rows(w)[2]!.trigger('click');
    await save(w).trigger('click');
    await flushPromises();
    expect(h.attachLists).toHaveBeenCalledTimes(1);
    expect(h.attachLists).toHaveBeenCalledWith(['a', 'c'], TRIP);
    expect(w.emitted('attached')?.[0]).toEqual([2, false]);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('marks the attach partial when the store dropped some of the pick', async () => {
    h.attachLists.mockResolvedValue([list('a')]);
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await rows(w)[1]!.trigger('click');
    await save(w).trigger('click');
    await flushPromises();
    expect(w.emitted('attached')?.[0]).toEqual([1, true]);
  });

  it('stays open when nothing was attached (every pick had gone by the write)', async () => {
    h.attachLists.mockResolvedValue([]);
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await save(w).trigger('click');
    await flushPromises();
    expect(w.emitted('attached')?.[0]).toEqual([0, true]);
    expect(w.emitted('close')).toBeUndefined();
  });

  it('a pick that stops being attachable no longer counts, and disables Attach when alone', async () => {
    const w = await openSheet();
    await rows(w)[1]!.trigger('click');
    expect(save(w).attributes('disabled')).toBeUndefined();
    candidates.value = [list('a', 'Packing'), list('c', 'Pharmacy')]; // 'b' linked elsewhere
    await flushPromises();
    expect(save(w).attributes('disabled')).toBeDefined();
    // Unlinked again on that device: it comes back unpicked, not silently pre-selected.
    candidates.value = [list('a', 'Packing'), list('b', 'Snacks'), list('c', 'Pharmacy')];
    await flushPromises();
    expect(rows(w)[1]!.attributes('aria-pressed')).toBe('false');
    expect(save(w).attributes('disabled')).toBeDefined();
  });

  it('keeps the sheet and the pick when the write fails, with no second toast', async () => {
    h.attachLists.mockResolvedValue(null);
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await save(w).trigger('click');
    await flushPromises();
    expect(w.emitted('failed')?.[0]).toEqual([1]);
    expect(w.emitted('close')).toBeUndefined();
    expect(rows(w)[0]!.attributes('aria-pressed')).toBe('true');
  });

  it('writes once on a double tap', async () => {
    let release!: (v: FamilyList[]) => void;
    h.attachLists.mockImplementationOnce(
      () => new Promise<FamilyList[]>((resolve) => (release = resolve))
    );
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await save(w).trigger('click');
    await save(w).trigger('click');
    release([list('a')]);
    await flushPromises();
    expect(h.attachLists).toHaveBeenCalledTimes(1);
  });

  it('resets the search and the pick each time it opens', async () => {
    const w = await openSheet();
    await rows(w)[0]!.trigger('click');
    await w.find('[data-testid="search"]').setValue('pack');
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(rows(w)).toHaveLength(3);
    expect(save(w).attributes('disabled')).toBeDefined();
  });

  it('opens at the overlay layer when stacked', async () => {
    const w = await openSheet({ stacked: true });
    expect(w.findComponent(ModalStub).props('layer')).toBe('overlay');
    expect(mountSheet({ open: true }).findComponent(ModalStub).props('layer')).toBe('base');
  });
});
