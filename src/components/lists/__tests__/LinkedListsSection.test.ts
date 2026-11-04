/**
 * LinkedListsSection: the Lists section a trip or an activity shows. Its behaviour is tested
 * here once; `ActivityLists` and `TripLists` are thin wrappers tested by the props they pass.
 *   - shows the host's lists; a member who can edit gets + New List / From a Template /
 *     Attach a List (in the eyebrow, or in the dashed row when nothing is linked),
 *   - a blank list is created linked to the target, opened, and discarded again if closed
 *     untouched, whichever path made it (+ New List, or the sheet's Start Blank List),
 *   - one telemetry shape on a surface derived from the target kind,
 *   - flag-guarded (`familyLists`).
 */
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList } from '@/types/models';
import type { ListLinkTarget } from '@/utils/activityLinks';

const h = vi.hoisted(() => ({
  flagOn: true,
  canEdit: true,
  createBlankList: vi.fn(),
  discardIfUntouched: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('@/config/flags', () => ({ isFlagEnabled: () => h.flagOn }));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canEditActivities: ref(h.canEdit) }),
}));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({
    createBlankList: h.createBlankList,
    discardIfUntouched: h.discardIfUntouched,
  }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'me' } }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => h.logEvent(...a),
}));

import LinkedListsSection from '../LinkedListsSection.vue';

const stubs = {
  LinkedListCard: true,
  NewListSheet: true,
  AttachListsSheet: true,
  ListDetailModal: true,
};

const SESSION: ListLinkTarget = {
  kind: 'activity',
  link: { activityId: 'series', activityDate: '2026-10-10' },
};
const TRIP: ListLinkTarget = { kind: 'trip', vacationId: 'trip-1' };

const list = (id: string) => ({ id }) as FamilyList;

type Props = InstanceType<typeof LinkedListsSection>['$props'];

function mountActivity(extra: Partial<Props> = {}) {
  return mount(LinkedListsSection, {
    props: {
      lists: [],
      target: SESSION,
      logContext: { activity_id: 'series' },
      stacked: true,
      ...extra,
    },
    global: { stubs },
  });
}

function mountTrip(extra: Partial<Props> = {}) {
  return mount(LinkedListsSection, {
    props: { lists: [], target: TRIP, blankCategory: 'trips', ...extra },
    global: { stubs },
  });
}

type Wrapper = ReturnType<typeof mountActivity>;
const detail = (w: Wrapper) => w.findComponent({ name: 'ListDetailModal' });
const sheet = (w: Wrapper) => w.findComponent({ name: 'NewListSheet' });
const attachSheet = (w: Wrapper) => w.findComponent({ name: 'AttachListsSheet' });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.flagOn = true;
  h.canEdit = true;
  h.createBlankList.mockResolvedValue({ id: 'new-list' });
  h.discardIfUntouched.mockResolvedValue('discarded');
});

describe('LinkedListsSection — visibility', () => {
  it('renders nothing with the familyLists flag off', () => {
    h.flagOn = false;
    const w = mountActivity({ lists: [{ item: list('a') }] });
    expect(w.find('[data-testid="linked-lists"]').exists()).toBe(false);
    expect(sheet(w).exists()).toBe(false);
    expect(attachSheet(w).exists()).toBe(false);
  });

  it('shows the dashed empty row carrying all three actions when nothing is linked', () => {
    const w = mountActivity();
    const empty = w.find('[data-testid="linked-lists-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('linkedLists.empty');
    // The actions ride in the empty row only, not also in the eyebrow.
    expect(empty.findAll('button')).toHaveLength(3);
    expect(w.findAll('button')).toHaveLength(3);
  });

  it('hides the whole section from a member who cannot edit when empty', () => {
    h.canEdit = false;
    const w = mountActivity();
    expect(w.find('[data-testid="linked-lists"]').exists()).toBe(false);
  });

  it('renders a card per list, passing the every-session tag, with actions in the eyebrow', () => {
    const w = mountActivity({
      lists: [
        { item: list('a'), everySession: false },
        { item: list('b'), everySession: true },
      ],
    });
    const cards = w.findAllComponents({ name: 'LinkedListCard' });
    expect(cards.map((c) => c.props('everySession'))).toEqual([false, true]);
    expect(w.find('[data-testid="linked-lists-empty"]').exists()).toBe(false);
    for (const key of ['blank', 'template', 'attach']) {
      expect(w.find(`[data-testid="linked-lists-${key}"]`).exists()).toBe(true);
    }
  });

  it('shows lists without actions to a member who cannot edit', () => {
    h.canEdit = false;
    const w = mountTrip({ lists: [{ item: list('a') }] });
    expect(w.findAllComponents({ name: 'LinkedListCard' })).toHaveLength(1);
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('opens a card in the list drawer, stacked only when the host is', async () => {
    const w = mountActivity({ lists: [{ item: list('a') }] });
    w.findComponent({ name: 'LinkedListCard' }).vm.$emit('open', 'a');
    await flushPromises();
    expect(detail(w).props('listId')).toBe('a');
    expect(detail(w).props('stacked')).toBe(true);
    expect(detail(mountTrip()).props('stacked')).toBe(false);
  });
});

describe('LinkedListsSection — + New List', () => {
  it('creates a blank list linked to the session and opens it', async () => {
    const w = mountActivity();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    await flushPromises();
    expect(h.createBlankList).toHaveBeenCalledWith('me', {
      category: undefined,
      linkedActivityId: 'series',
      activityDate: '2026-10-10',
    });
    expect(detail(w).props('listId')).toBe('new-list');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'activity-links',
        message: 'list_created',
        context: { action: 'list_created', activity_id: 'series', detail: 'blank', kind: 'blank' },
      })
    );
  });

  it('on a trip, links by the trip id, starts in the blank category, and logs on trip-lists', async () => {
    const w = mountTrip();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    await flushPromises();
    expect(h.createBlankList).toHaveBeenCalledWith('me', {
      category: 'trips',
      linkedVacationId: 'trip-1',
    });
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'trip-lists',
        message: 'list_created',
        // No trip id: there is no allowlisted key for one, so the surface identifies it.
        context: { action: 'list_created', detail: 'blank', kind: 'blank' },
      })
    );
  });

  it('disables every action while a create is in flight', async () => {
    let release!: (v: { id: string }) => void;
    h.createBlankList.mockImplementationOnce(
      () => new Promise<{ id: string }>((resolve) => (release = resolve))
    );
    const w = mountActivity();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    for (const key of ['blank', 'template', 'attach']) {
      expect(w.find(`[data-testid="linked-lists-${key}"]`).attributes('disabled')).toBeDefined();
    }
    // The trip's "+ Add a Plan" → List is held off too.
    (w.vm as unknown as { openNewList: () => void }).openNewList();
    await flushPromises();
    expect(sheet(w).props('open')).toBe(false);
    release({ id: 'new-list' });
    await flushPromises();
    expect(w.find('[data-testid="linked-lists-template"]').attributes('disabled')).toBeUndefined();
  });

  it('logs the failure and opens nothing when the store returns null', async () => {
    h.createBlankList.mockResolvedValue(null);
    const w = mountActivity();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    await flushPromises();
    expect(detail(w).props('listId')).toBeNull();
    expect(h.logEvent).toHaveBeenCalledTimes(1);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'activity-links',
        message: 'list_create_failed',
        context: {
          action: 'list_create_failed',
          activity_id: 'series',
          detail: 'blank',
          kind: 'blank',
        },
      })
    );
  });
});

describe('LinkedListsSection — From a Template', () => {
  it('opens the sheet with the link, the suggested template, the blank category and stacking', async () => {
    const w = mountTrip({ suggestedTemplateKey: 'vacation-packing' });
    expect(sheet(w).props('open')).toBe(false);
    await w.find('[data-testid="linked-lists-template"]').trigger('click');
    expect(sheet(w).props()).toMatchObject({
      open: true,
      stacked: false,
      suggestedTemplateKey: 'vacation-packing',
      blankCategory: 'trips',
      overrides: { linkedVacationId: 'trip-1' },
    });
  });

  it('openNewList() opens the same sheet (the trip page’s + Add a Plan → List)', async () => {
    const w = mountTrip();
    (w.vm as unknown as { openNewList: () => void }).openNewList();
    await flushPromises();
    expect(sheet(w).props('open')).toBe(true);
  });

  it('opens the created list and counts it with its template key', async () => {
    const w = mountActivity();
    sheet(w).vm.$emit('created', 'tmpl-list', 'party-prep');
    await flushPromises();
    expect(detail(w).props('listId')).toBe('tmpl-list');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'list_created',
        context: {
          action: 'list_created',
          activity_id: 'series',
          detail: 'template',
          kind: 'party-prep',
        },
      })
    );
  });

  it('counts a failed template create from the sheet', () => {
    const w = mountActivity();
    sheet(w).vm.$emit('failed', 'party-prep');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: 'list_create_failed',
        context: {
          action: 'list_create_failed',
          activity_id: 'series',
          detail: 'template',
          kind: 'party-prep',
        },
      })
    );
  });
});

describe('LinkedListsSection — Attach a List', () => {
  it('opens the attach sheet for the target', async () => {
    const w = mountActivity();
    expect(attachSheet(w).props('open')).toBe(false);
    await w.find('[data-testid="linked-lists-attach"]').trigger('click');
    expect(attachSheet(w).props()).toMatchObject({ open: true, target: SESSION, stacked: true });
  });

  it('counts an attach, all or partial', () => {
    const w = mountTrip();
    attachSheet(w).vm.$emit('attached', 2, false);
    attachSheet(w).vm.$emit('attached', 1, true);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'trip-lists',
        message: 'lists_attached',
        context: { action: 'lists_attached', count: 2, detail: 'all' },
      })
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'lists_attached', count: 1, detail: 'partial' },
      })
    );
  });

  it('counts an attach that linked nothing (every pick had gone) as none, not a success', () => {
    const w = mountTrip();
    attachSheet(w).vm.$emit('attached', 0, true);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: 'lists_attached',
        context: { action: 'lists_attached', count: 0, detail: 'none' },
      })
    );
  });

  it('counts a failed attach', () => {
    const w = mountActivity();
    attachSheet(w).vm.$emit('failed', 3);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'activity-links',
        message: 'lists_attach_failed',
        context: { action: 'lists_attach_failed', activity_id: 'series', count: 3 },
      })
    );
  });
});

describe('LinkedListsSection — discarding an untouched blank list', () => {
  async function createBlank() {
    const w = mountActivity();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    await flushPromises();
    return w;
  }

  it('closing the new blank list asks the store to discard it if untouched, and counts it', async () => {
    const w = await createBlank();
    expect(detail(w).props('listId')).toBe('new-list');
    detail(w).vm.$emit('close');
    await flushPromises();
    expect(h.discardIfUntouched).toHaveBeenCalledWith('new-list');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        message: 'blank_list_closed',
        context: { action: 'blank_list_closed', activity_id: 'series', detail: 'discarded' },
      })
    );
  });

  it('a blank started from the sheet (no template key) is discarded the same way', async () => {
    const w = mountTrip();
    sheet(w).vm.$emit('created', 'sheet-blank');
    await flushPromises();
    detail(w).vm.$emit('close');
    await flushPromises();
    expect(h.discardIfUntouched).toHaveBeenCalledWith('sheet-blank');
  });

  it('unmounting with the new list still open discards it too', async () => {
    const w = await createBlank();
    w.unmount();
    await flushPromises();
    expect(h.discardIfUntouched).toHaveBeenCalledWith('new-list');
  });

  it('a blank whose create resolves after the section unmounted is discarded, never opened', async () => {
    let release!: (v: { id: string }) => void;
    h.createBlankList.mockImplementationOnce(
      () => new Promise<{ id: string }>((resolve) => (release = resolve))
    );
    const w = mountTrip();
    await w.find('[data-testid="linked-lists-blank"]').trigger('click');
    w.unmount(); // switched trips mid-create
    expect(h.discardIfUntouched).not.toHaveBeenCalled();
    release({ id: 'late-blank' });
    await flushPromises();
    expect(h.discardIfUntouched).toHaveBeenCalledWith('late-blank');
  });

  it('never discards a list created from a template, or one opened from the section', async () => {
    const w = mountActivity({ lists: [{ item: list('old') }] });
    sheet(w).vm.$emit('created', 'tpl-list', 'party-prep');
    await flushPromises();
    detail(w).vm.$emit('close');
    w.findComponent({ name: 'LinkedListCard' }).vm.$emit('open', 'old');
    await flushPromises();
    detail(w).vm.$emit('close');
    w.unmount();
    await flushPromises();
    expect(h.discardIfUntouched).not.toHaveBeenCalled();
  });
});
