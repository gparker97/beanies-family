/**
 * ActivityLists (#114): the Activity Details Lists section. Shows the session's lists, tags the
 * whole-activity ones, and lets a member who can edit activities start a linked list (blank or
 * from a template) that opens straight away. Flag-guarded by `familyLists`.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyActivity, FamilyList } from '@/types/models';

const h = vi.hoisted(() => ({
  flagOn: true,
  canEdit: true,
  sessionItems: [] as { item: { id: string }; scope: 'session' | 'every-session' }[],
  createBlankList: vi.fn(),
  discardIfUntouched: vi.fn(),
  listsForActivitySession: vi.fn(),
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
    listsForActivitySession: h.listsForActivitySession,
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

import ActivityLists from '../ActivityLists.vue';

const stubs = { LinkedListCard: true, NewListSheet: true, ListDetailModal: true };

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'series',
    title: 'Soccer Practice',
    date: '2026-09-05',
    category: 'soccer',
    recurrence: 'weekly',
    ...overrides,
  } as FamilyActivity;
}

function mountLists(act: FamilyActivity = activity()) {
  return mount(ActivityLists, {
    props: { activity: act, sessionYmd: '2026-10-10' },
    global: { stubs },
  });
}

const list = (id: string) => ({ id }) as FamilyList;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.flagOn = true;
  h.canEdit = true;
  h.sessionItems = [];
  h.listsForActivitySession.mockImplementation(() => h.sessionItems);
  h.createBlankList.mockResolvedValue({ id: 'new-list' });
  h.discardIfUntouched.mockResolvedValue('discarded');
});

describe('ActivityLists — visibility', () => {
  it('renders nothing with the familyLists flag off', () => {
    h.flagOn = false;
    h.sessionItems = [{ item: list('a'), scope: 'session' }];
    const w = mountLists();
    expect(w.find('[data-testid="activity-lists"]').exists()).toBe(false);
    expect(w.findComponent({ name: 'NewListSheet' }).exists()).toBe(false);
  });

  it('shows the dashed empty row carrying both actions when nothing is linked', () => {
    const w = mountLists();
    const empty = w.find('[data-testid="activity-lists-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('activityLists.empty');
    // The actions ride in the empty row only, not also in the eyebrow.
    expect(empty.findAll('button')).toHaveLength(2);
    expect(w.findAll('button')).toHaveLength(2);
  });

  it('hides the whole section from a member who cannot edit activities when empty', () => {
    h.canEdit = false;
    const w = mountLists();
    expect(w.find('[data-testid="activity-lists"]').exists()).toBe(false);
  });

  it('renders a card per session list, tagging the whole-activity ones, with actions in the eyebrow', () => {
    h.sessionItems = [
      { item: list('a'), scope: 'session' },
      { item: list('b'), scope: 'every-session' },
    ];
    const w = mountLists();
    const cards = w.findAllComponents({ name: 'LinkedListCard' });
    expect(cards.map((c) => c.props('everySession'))).toEqual([false, true]);
    expect(h.listsForActivitySession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'series' }),
      '2026-10-10'
    );
    expect(w.find('[data-testid="activity-lists-empty"]').exists()).toBe(false);
    expect(w.find('[data-testid="activity-lists-blank"]').exists()).toBe(true);
    expect(w.find('[data-testid="activity-lists-template"]').exists()).toBe(true);
  });

  it('shows lists without actions to a member who cannot edit activities', () => {
    h.canEdit = false;
    h.sessionItems = [{ item: list('a'), scope: 'session' }];
    const w = mountLists();
    expect(w.findAllComponents({ name: 'LinkedListCard' })).toHaveLength(1);
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('opens a card in the stacked list drawer', async () => {
    h.sessionItems = [{ item: list('a'), scope: 'session' }];
    const w = mountLists();
    w.findComponent({ name: 'LinkedListCard' }).vm.$emit('open', 'a');
    await flushPromises();
    const detail = w.findComponent({ name: 'ListDetailModal' });
    expect(detail.props('listId')).toBe('a');
    expect(detail.props('stacked')).toBe(true);
  });
});

describe('ActivityLists — + New List', () => {
  it('creates a blank list linked to this session and opens it', async () => {
    const w = mountLists();
    await w.find('[data-testid="activity-lists-blank"]').trigger('click');
    await flushPromises();
    expect(h.createBlankList).toHaveBeenCalledWith('me', {
      linkedActivityId: 'series',
      activityDate: '2026-10-10',
    });
    expect(w.findComponent({ name: 'ListDetailModal' }).props('listId')).toBe('new-list');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'activity-links',
        message: 'list_created',
        context: {
          action: 'list_created',
          activity_id: 'series',
          detail: 'blank',
          kind: 'blank',
        },
      })
    );
  });

  it('links a one-off activity by id alone (no session date)', async () => {
    const w = mountLists(activity({ id: 'one-off', recurrence: 'none' }));
    await w.find('[data-testid="activity-lists-blank"]').trigger('click');
    await flushPromises();
    expect(h.createBlankList).toHaveBeenCalledWith('me', {
      linkedActivityId: 'one-off',
      activityDate: undefined,
    });
  });

  it('logs the failure and opens nothing when the store returns null', async () => {
    h.createBlankList.mockResolvedValue(null);
    const w = mountLists();
    await w.find('[data-testid="activity-lists-blank"]').trigger('click');
    await flushPromises();
    expect(w.findComponent({ name: 'ListDetailModal' }).props('listId')).toBeNull();
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

describe('ActivityLists — From a Template', () => {
  it('opens the stacked sheet with the link and the suggested template', async () => {
    const w = mountLists(activity({ category: 'birthday' }));
    const sheet = () => w.findComponent({ name: 'NewListSheet' });
    expect(sheet().props('open')).toBe(false);
    await w.find('[data-testid="activity-lists-template"]').trigger('click');
    expect(sheet().props()).toMatchObject({
      open: true,
      stacked: true,
      suggestedTemplateKey: 'party-prep',
      overrides: { linkedActivityId: 'series', activityDate: '2026-10-10' },
    });
  });

  it('suggests nothing for a sports activity', () => {
    const w = mountLists();
    expect(w.findComponent({ name: 'NewListSheet' }).props('suggestedTemplateKey')).toBeUndefined();
  });

  it('opens the created list and counts it with its template key', async () => {
    const w = mountLists(activity({ category: 'birthday' }));
    w.findComponent({ name: 'NewListSheet' }).vm.$emit('created', 'tmpl-list', 'party-prep');
    await flushPromises();
    expect(w.findComponent({ name: 'ListDetailModal' }).props('listId')).toBe('tmpl-list');
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
    const w = mountLists(activity({ category: 'birthday' }));
    w.findComponent({ name: 'NewListSheet' }).vm.$emit('failed', 'party-prep');
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

describe('ActivityLists — discarding an untouched blank list', () => {
  async function createBlank() {
    const w = mountLists();
    await w.find('[data-testid="activity-lists-blank"]').trigger('click');
    await flushPromises();
    return w;
  }
  const detail = (w: ReturnType<typeof mountLists>) => w.findComponent({ name: 'ListDetailModal' });

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

  it('closing the activity drawer with the new list still open discards it too', async () => {
    const w = await createBlank();
    w.unmount();
    await flushPromises();
    expect(h.discardIfUntouched).toHaveBeenCalledWith('new-list');
  });

  it('never discards a list created from a template, or one opened from the section', async () => {
    h.sessionItems = [{ item: list('old'), scope: 'session' }];
    const w = mountLists(activity({ category: 'birthday' }));
    w.findComponent({ name: 'NewListSheet' }).vm.$emit('created', 'tpl-list', 'party-prep');
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
