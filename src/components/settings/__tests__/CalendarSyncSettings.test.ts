/**
 * CalendarSyncSettings — error-handling contract for the two actions whose
 * underlying store methods swallow failures into connection status. The view must
 * toast the REAL outcome, never an unconditional success. Covers the fixes made
 * when Google Calendar graduated from The Beanie Lab (2026-07-03).
 *
 * Also the card itself (view-only calendars plan 2026-11-17, P2): the destination is
 * fixed text (no dropdown), and the add button's label follows whether anything is
 * connected and opens the add step.
 *
 * P6: with `viewOnlyCalendars` on, the two groups ("Synced from beanies.family" /
 * "View only"), the label rule counting viewed calendars, and the card intents.
 *
 * Revised after testing: every calendar is a row that opens (the only one, or one
 * just added, starts open), the clash toggle lives in an "All Calendars" group,
 * Disconnect sits in the synced card's action row, and the synced heading carries a
 * "(push only)" help link, with the flag off too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, nextTick, ref } from 'vue';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import CalendarSyncSettings from '../CalendarSyncSettings.vue';
import { showToast } from '@/composables/useToast';
import { confirm } from '@/composables/useConfirm';
import { openExternal } from '@/utils/openExternal';
import { MARKETING_URL } from '@/utils/marketing';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('@/utils/openExternal', () => ({ openExternal: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const flags = vi.hoisted(() => ({ on: new Set<string>() }));
vi.mock('@/config/flags', () => ({ isFlagEnabled: (name: string) => flags.on.has(name) }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    calendarClashNudgeEnabled: false,
    setCalendarClashNudgeEnabled: vi.fn(),
  }),
}));

const syncNow = vi.fn();
const disconnect = vi.fn();
const CONNECTION = {
  id: 'c1',
  accountEmail: 'a@b.com',
  status: 'ok',
  destinationCalendarId: 'primary',
  grantedScopes: [] as string[],
  destinationCalendarName: undefined as string | undefined,
};
const mockStore = reactive({
  connections: [{ ...CONNECTION }] as Array<typeof CONNECTION>,
  pendingConnect: null as { accountEmail: string | null } | null,
  syncNow,
  disconnect,
  reconnect: vi.fn(),
  resolveDestinationName: vi.fn(async (): Promise<string | null> => null),
});
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => mockStore }));
// The Reconnect button is now offered only to whoever can actually complete the
// consent (it is account-bound), so the card reads the roster and permissions.
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], currentMemberId: 'm1' }),
}));
const canManagePod = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canManagePod }),
}));

const VIEWED = {
  id: 'v1',
  viewAccountId: 'a1',
  calendarId: 'grandma@example.com',
  name: 'Grandma',
  accessRole: 'reader',
  detailLevel: 'details',
  color: '#6b7280',
  inBriefing: false,
  inWidgets: false,
};
const viewStore = reactive({
  accounts: [{ id: 'a1', accountEmail: 'a@b.com' }],
  calendars: [] as Array<typeof VIEWED>,
  pendingViewConnect: null as { accountEmail: string | null } | null,
  calendarState: vi.fn((): string | null => 'ok'),
  updateViewedCalendar: vi.fn(async () => ({ status: 'updated' })),
  removeViewedCalendar: vi.fn(async () => ({ status: 'removed' })),
  reconnectViewAccount: vi.fn(async () => ({ status: 'reconnected' })),
});
const useCalendarViewStore = vi.fn(() => viewStore);
vi.mock('@/stores/calendarViewStore', () => ({
  useCalendarViewStore: () => useCalendarViewStore(),
}));

// The stores are shared reactive mocks: a drawer left mounted by an earlier test
// would keep watching them and react to (and count against) the next test.
enableAutoUnmount(afterEach);

function mountDrawer(props: { open: boolean } = { open: true }) {
  return mount(CalendarSyncSettings, {
    props,
    global: {
      stubs: {
        BeanieFormModal: { template: '<div><slot /></div>' },
        ToggleRow: true,
        CalendarConnectModal: {
          props: ['canAddViewOnly'],
          template: '<div data-testid="connect-modal" :data-view="String(canAddViewOnly)" />',
        },
        ViewedCalendarCard: {
          props: ['calendar', 'accountEmail', 'state', 'canManage', 'canReconnect', 'open'],
          emits: ['update', 'disconnect', 'reconnect', 'update:open'],
          template: `<div data-testid="viewed-card" :data-email="accountEmail" :data-state="state"
            :data-manage="String(canManage)" :data-open="String(open)">
            <button class="vc-toggle" @click="$emit('update:open', !open)" />
            <button class="vc-update" @click="$emit('update', { inBriefing: true })" />
            <button class="vc-disconnect" @click="$emit('disconnect')" />
            <button class="vc-reconnect" @click="$emit('reconnect')" />
          </div>`,
        },
        CalendarImportModal: true,
        BaseButton: {
          emits: ['click'],
          template: '<button class="bb" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

/** A synced calendar's row (`CalendarCardShell` inside `SyncedCalendarCard`). */
function syncedRow(wrapper: ReturnType<typeof mountDrawer>, id: string) {
  return wrapper.get(`[data-testid="synced-calendar-${id}"]`);
}
function isSyncedOpen(wrapper: ReturnType<typeof mountDrawer>, id: string): boolean {
  return (
    syncedRow(wrapper, id)
      .get('[data-testid="calendar-card-toggle"]')
      .attributes('aria-expanded') === 'true'
  );
}

/** Find a stubbed BaseButton by its slotted i18n-key text. */
function button(wrapper: ReturnType<typeof mountDrawer>, key: string) {
  return wrapper.findAll('button.bb').find((b) => b.text().includes(key))!;
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.on = new Set();
  canManagePod.value = true;
  viewStore.calendars = [];
  viewStore.pendingViewConnect = null;
  mockStore.connections = [{ ...CONNECTION }];
  mockStore.pendingConnect = null;
  mockStore.resolveDestinationName.mockResolvedValue(null);
});

describe('CalendarSyncSettings — connection card and add button', () => {
  it('shows the destination calendar’s name as fixed text, with no calendar picker', async () => {
    mockStore.resolveDestinationName.mockResolvedValue('Family');
    const wrapper = mountDrawer();
    await flushPromises();

    expect(syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-name"]').text()).toBe(
      'Family'
    );
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.text()).toContain('a@b.com');
    expect(mockStore.resolveDestinationName).toHaveBeenCalledTimes(1);
  });

  // Review round 3, T7.
  it('T7: a stored name is shown with no lookup at all', async () => {
    mockStore.connections = [{ ...CONNECTION, destinationCalendarName: 'Kids' }];
    const wrapper = mountDrawer();
    await flushPromises();
    expect(syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-name"]').text()).toBe('Kids');
    expect(mockStore.resolveDestinationName).not.toHaveBeenCalled();
  });

  it('T7: an unreadable non-primary calendar is never titled "Primary calendar"', async () => {
    mockStore.connections = [
      { ...CONNECTION, destinationCalendarId: 'kids@group.calendar.google.com' },
      { ...CONNECTION, id: 'c2', destinationCalendarId: 'a@b.com' },
    ];
    const wrapper = mountDrawer();
    await flushPromises();
    expect(syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-name"]').text()).toBe(
      'calendarSync.calendarNameUnavailable'
    );
    // The account's primary under its real id still reads "Primary calendar".
    expect(syncedRow(wrapper, 'c2').get('[data-testid="calendar-card-name"]').text()).toBe(
      'calendarSync.primaryCalendar'
    );
  });

  it('T7: a failed lookup is tried again after a reconnect, never on every tick', async () => {
    mockStore.connections = [{ ...CONNECTION, status: 'needs_reconnect' }];
    const wrapper = mountDrawer();
    await flushPromises();
    expect(mockStore.resolveDestinationName).toHaveBeenCalledTimes(1);

    // An unrelated change to the record: no second lookup.
    mockStore.connections = [{ ...CONNECTION, status: 'needs_reconnect' }];
    await flushPromises();
    expect(mockStore.resolveDestinationName).toHaveBeenCalledTimes(1);

    // Reconnected: tried again, and the name it finds is shown.
    mockStore.resolveDestinationName.mockResolvedValue('Family');
    mockStore.connections = [{ ...CONNECTION, status: 'ok' }];
    await flushPromises();
    expect(mockStore.resolveDestinationName).toHaveBeenCalledTimes(2);
    expect(syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-name"]').text()).toBe(
      'Family'
    );
  });

  it('T7: nothing is looked up (or written back) while the drawer is closed', async () => {
    const wrapper = mountDrawer({ open: false });
    await flushPromises();
    expect(mockStore.resolveDestinationName).not.toHaveBeenCalled();
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(mockStore.resolveDestinationName).toHaveBeenCalledTimes(1);
  });

  it('falls back to "Primary calendar" when the name cannot be read', async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    expect(syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-name"]').text()).toBe(
      'calendarSync.primaryCalendar'
    );
  });

  it('reads "Connect a Google Calendar" with nothing connected, "Connect Another" otherwise', async () => {
    mockStore.connections = [];
    const empty = mountDrawer();
    expect(button(empty, 'calendarSync.action.connect')).toBeDefined();
    expect(empty.text()).not.toContain('calendarSync.action.connectAnother');

    mockStore.connections = [{ ...CONNECTION }];
    const one = mountDrawer();
    expect(one.text()).toContain('calendarSync.action.connectAnother');
  });

  it('opens the add step from the button', async () => {
    const wrapper = mountDrawer();
    expect(wrapper.find('[data-testid="connect-modal"]').exists()).toBe(false);
    await button(wrapper, 'calendarSync.action.connectAnother').trigger('click');
    expect(wrapper.find('[data-testid="connect-modal"]').exists()).toBe(true);
  });

  it('opens the add step by itself when a consent is pending (a redirect return)', async () => {
    const wrapper = mountDrawer();
    mockStore.pendingConnect = { accountEmail: 'a@b.com' };
    await nextTick();
    expect(wrapper.find('[data-testid="connect-modal"]').exists()).toBe(true);
  });
});

describe('CalendarSyncSettings — Sync now', () => {
  it('toasts success on a clean outcome', async () => {
    syncNow.mockResolvedValue('ok');
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.syncNow').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarSync.toast.synced.title',
      expect.anything()
    );
  });

  it('toasts an ERROR (not success) when the sync outcome is error', async () => {
    syncNow.mockResolvedValue('error');
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.syncNow').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.syncFailed.title',
      'calendarSync.toast.syncFailed.message',
      expect.objectContaining({ silent: true })
    );
    expect(showToast).not.toHaveBeenCalledWith('success', expect.anything(), expect.anything());
  });

  it('toasts a reconnect prompt when the outcome is needs_reconnect', async () => {
    syncNow.mockResolvedValue('needs_reconnect');
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.syncNow').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.syncReconnect.title',
      'calendarSync.toast.syncReconnect.message',
      expect.anything()
    );
  });

  it('catches a thrown store error and toasts (no unhandled rejection)', async () => {
    syncNow.mockRejectedValue(new Error('idb boom'));
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.syncNow').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.syncFailed.title',
      'calendarSync.toast.syncFailed.message',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });
});

describe('CalendarSyncSettings — Disconnect', () => {
  it('toasts success when teardown fully completes', async () => {
    disconnect.mockResolvedValue(true);
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.disconnect').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarSync.toast.disconnected.title',
      expect.anything()
    );
  });

  it('toasts a partial-failure (not success) when teardown is incomplete', async () => {
    disconnect.mockResolvedValue(false);
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.disconnect').trigger('click');
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.disconnectPartial.title',
      'calendarSync.toast.disconnectPartial.message',
      expect.objectContaining({ silent: true })
    );
    expect(showToast).not.toHaveBeenCalledWith(
      'success',
      'calendarSync.toast.disconnected.title',
      expect.anything()
    );
  });
});

describe('CalendarSyncSettings — view-only calendars', () => {
  it('with the flag off: the old intro, the synced heading + link, no View only, no view store', () => {
    flags.on = new Set(['calendarClashNudge']);
    const wrapper = mountDrawer();
    expect(wrapper.text()).toContain('calendarSync.intro');
    expect(wrapper.text()).not.toContain('calendarSync.introWithView');
    // The rows, the heading with its "(push only)" link and the All Calendars group
    // improve the sync drawer itself, so they are not behind the view-only flag.
    expect(wrapper.get('[data-testid="calendar-sync-group-synced"]').text()).toBe(
      'calendarSync.group.synced'
    );
    expect(wrapper.find('[data-testid="calendar-sync-push-only"]').exists()).toBe(true);
    expect(isSyncedOpen(wrapper, 'c1')).toBe(true);
    expect(wrapper.find('[data-testid="calendar-sync-group-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="calendar-sync-group-view"]').exists()).toBe(false);
    expect(useCalendarViewStore).not.toHaveBeenCalled();
  });

  it('with the flag on: the reworded intro and the Synced group; View only omitted when empty', () => {
    flags.on = new Set(['viewOnlyCalendars']);
    const wrapper = mountDrawer();
    expect(wrapper.text()).toContain('calendarSync.introWithView');
    expect(wrapper.get('[data-testid="calendar-sync-group-synced"]').text()).toBe(
      'calendarSync.group.synced'
    );
    expect(wrapper.find('[data-testid="calendar-sync-group-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="viewed-card"]').exists()).toBe(false);
  });

  it('shows one card per viewed calendar under View only', () => {
    flags.on = new Set(['viewOnlyCalendars']);
    viewStore.calendars = [{ ...VIEWED }, { ...VIEWED, id: 'v2', calendarId: 'work' }];
    viewStore.calendarState.mockReturnValue('stale');
    const wrapper = mountDrawer();

    expect(wrapper.get('[data-testid="calendar-sync-group-view"]').text()).toBe(
      'calendarSync.group.viewOnly'
    );
    const cards = wrapper.findAll('[data-testid="viewed-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.attributes('data-email')).toBe('a@b.com');
    expect(cards[0]!.attributes('data-state')).toBe('stale');
    expect(cards[0]!.attributes('data-manage')).toBe('true');
  });

  it('a viewed calendar alone makes the button "Connect Another" and shows the clash toggle', () => {
    flags.on = new Set(['viewOnlyCalendars', 'calendarClashNudge']);
    mockStore.connections = [];
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    expect(wrapper.text()).toContain('calendarSync.action.connectAnother');
    expect(wrapper.find('toggle-row-stub').exists()).toBe(true);
    expect(wrapper.find('[data-testid="calendar-sync-group-synced"]').exists()).toBe(false);
  });

  it('with nothing connected the button reads "Connect a Google Calendar" and no clash toggle', () => {
    flags.on = new Set(['viewOnlyCalendars', 'calendarClashNudge']);
    mockStore.connections = [];
    const wrapper = mountDrawer();
    expect(button(wrapper, 'calendarSync.action.connect')).toBeDefined();
    expect(wrapper.text()).not.toContain('calendarSync.action.connectAnother');
    expect(wrapper.find('toggle-row-stub').exists()).toBe(false);
  });

  it('offers View only in the add step to managers only', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.connectAnother').trigger('click');
    expect(wrapper.get('[data-testid="connect-modal"]').attributes('data-view')).toBe('true');

    canManagePod.value = false;
    await nextTick();
    expect(wrapper.get('[data-testid="connect-modal"]').attributes('data-view')).toBe('false');
  });

  it('opens the add step by itself when a view consent is pending (a redirect return)', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    const wrapper = mountDrawer();
    viewStore.pendingViewConnect = { accountEmail: 'a@b.com' };
    await nextTick();
    expect(wrapper.find('[data-testid="connect-modal"]').exists()).toBe(true);
  });

  it('routes the card intents to the view store (disconnect through the confirm)', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();

    await wrapper.get('.vc-update').trigger('click');
    expect(viewStore.updateViewedCalendar).toHaveBeenCalledWith('v1', { inBriefing: true });

    await wrapper.get('.vc-disconnect').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'calendarView.disconnect.title',
        message: 'calendarView.disconnect.message',
        variant: 'danger',
      })
    );
    expect(viewStore.removeViewedCalendar).toHaveBeenCalledWith('v1');
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarView.toast.disconnected.title',
      'calendarView.toast.disconnected.message'
    );
  });

  it('a declined disconnect confirm removes nothing', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    viewStore.calendars = [{ ...VIEWED }];
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const wrapper = mountDrawer();
    await wrapper.get('.vc-disconnect').trigger('click');
    await flushPromises();
    expect(viewStore.removeViewedCalendar).not.toHaveBeenCalled();
  });

  it('a member who cannot manage the pod changes nothing, even if a card emits', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    canManagePod.value = false;
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    expect(wrapper.get('[data-testid="viewed-card"]').attributes('data-manage')).toBe('false');

    await wrapper.get('.vc-update').trigger('click');
    await wrapper.get('.vc-disconnect').trigger('click');
    await flushPromises();
    expect(viewStore.updateViewedCalendar).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Reconnect signs the view account in again and toasts the outcome', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    await wrapper.get('.vc-reconnect').trigger('click');
    await flushPromises();
    expect(viewStore.reconnectViewAccount).toHaveBeenCalledWith('a1');
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarView.toast.reconnected.title',
      'calendarView.toast.reconnected.message'
    );
  });
});

describe('CalendarSyncSettings — rows that open', () => {
  it('the only calendar in the drawer starts open', () => {
    const wrapper = mountDrawer();
    expect(isSyncedOpen(wrapper, 'c1')).toBe(true);
  });

  it('a lone view-only calendar starts open too', () => {
    flags.on = new Set(['viewOnlyCalendars']);
    mockStore.connections = [];
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    expect(wrapper.get('[data-testid="viewed-card"]').attributes('data-open')).toBe('true');
  });

  it('with two or more calendars every row starts closed', () => {
    flags.on = new Set(['viewOnlyCalendars']);
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    expect(isSyncedOpen(wrapper, 'c1')).toBe(false);
    expect(wrapper.get('[data-testid="viewed-card"]').attributes('data-open')).toBe('false');

    mockStore.connections = [{ ...CONNECTION }, { ...CONNECTION, id: 'c2' }];
    viewStore.calendars = [];
    const twoSynced = mountDrawer();
    expect(isSyncedOpen(twoSynced, 'c1')).toBe(false);
    expect(isSyncedOpen(twoSynced, 'c2')).toBe(false);
  });

  it('a calendar added while the drawer is open starts open; the others keep their state', async () => {
    flags.on = new Set(['viewOnlyCalendars']);
    const wrapper = mountDrawer();
    expect(isSyncedOpen(wrapper, 'c1')).toBe(true);

    mockStore.connections.push({ ...CONNECTION, id: 'c2' });
    await nextTick();
    expect(isSyncedOpen(wrapper, 'c2')).toBe(true);
    // Adding a second calendar never snaps the first one shut.
    expect(isSyncedOpen(wrapper, 'c1')).toBe(true);

    viewStore.calendars = [{ ...VIEWED }];
    await nextTick();
    expect(wrapper.get('[data-testid="viewed-card"]').attributes('data-open')).toBe('true');
  });

  it('reopening the drawer starts a fresh session (everything closed with two or more)', async () => {
    const wrapper = mountDrawer();
    mockStore.connections.push({ ...CONNECTION, id: 'c2' });
    await nextTick();
    expect(isSyncedOpen(wrapper, 'c2')).toBe(true);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect(isSyncedOpen(wrapper, 'c1')).toBe(false);
    expect(isSyncedOpen(wrapper, 'c2')).toBe(false);
  });

  it('tapping a row toggles it', async () => {
    mockStore.connections = [{ ...CONNECTION }, { ...CONNECTION, id: 'c2' }];
    const wrapper = mountDrawer();
    const toggle = syncedRow(wrapper, 'c2').get('[data-testid="calendar-card-toggle"]');
    await toggle.trigger('click');
    expect(isSyncedOpen(wrapper, 'c2')).toBe(true);
    expect(isSyncedOpen(wrapper, 'c1')).toBe(false);
    await toggle.trigger('click');
    expect(isSyncedOpen(wrapper, 'c2')).toBe(false);
  });

  it('a member who cannot manage the pod can still open a row', async () => {
    canManagePod.value = false;
    mockStore.connections = [{ ...CONNECTION }, { ...CONNECTION, id: 'c2' }];
    const wrapper = mountDrawer();
    await syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-toggle"]').trigger('click');
    expect(isSyncedOpen(wrapper, 'c1')).toBe(true);
  });

  it.each([
    ['needs_reconnect', 'calendarSync.status.needsReconnect', 'attention'],
    ['error', 'calendarSync.status.error', 'attention'],
    ['ok', 'calendarSync.status.ok', 'neutral'],
  ])('a closed synced row shows %s on the row itself', (status, key, tone) => {
    mockStore.connections = [
      { ...CONNECTION, status },
      { ...CONNECTION, id: 'c2' },
    ];
    const wrapper = mountDrawer();
    expect(isSyncedOpen(wrapper, 'c1')).toBe(false);
    const pill = syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-status"]');
    expect(pill.text()).toBe(key);
    expect(pill.attributes('data-tone')).toBe(tone);
  });
});

describe('CalendarSyncSettings — action row, All Calendars and the push-only link', () => {
  it('Disconnect sits in the synced action row beside Sync now and Import, and confirms first', async () => {
    disconnect.mockResolvedValue(true);
    const wrapper = mountDrawer();
    const actions = syncedRow(wrapper, 'c1').get('[data-testid="calendar-card-actions"]');
    const labels = actions.findAll('button.bb').map((b) => b.text());
    expect(labels).toEqual([
      'calendarSync.action.syncNow',
      'calendarImport.start',
      'calendarSync.action.disconnect',
    ]);

    await actions.findAll('button.bb')[2]!.trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'calendarSync.disconnect.title',
        message: 'calendarSync.disconnect.message',
        variant: 'danger',
      })
    );
    expect(disconnect).toHaveBeenCalledWith('c1');
  });

  it('a declined synced disconnect confirm removes nothing', async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const wrapper = mountDrawer();
    await button(wrapper, 'calendarSync.action.disconnect').trigger('click');
    await flushPromises();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('Reconnect joins the same action row when the connection needs it', () => {
    mockStore.connections = [{ ...CONNECTION, status: 'needs_reconnect' }];
    const wrapper = mountDrawer();
    const labels = syncedRow(wrapper, 'c1')
      .get('[data-testid="calendar-card-actions"]')
      .findAll('button.bb')
      .map((b) => b.text());
    expect(labels[0]).toBe('calendarSync.action.reconnect');
    expect(labels).toContain('calendarSync.action.disconnect');
  });

  it('the clash toggle is in the All Calendars group, after both groups and before the add button', () => {
    flags.on = new Set(['viewOnlyCalendars', 'calendarClashNudge']);
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    const group = wrapper.get('[data-testid="calendar-sync-group-all"]');
    expect(group.get('h3').text()).toBe('calendarSync.group.all');
    expect(group.find('toggle-row-stub').exists()).toBe(true);
    expect(wrapper.findAll('toggle-row-stub')).toHaveLength(1);

    const order = wrapper
      .findAll(
        '[data-testid="calendar-sync-group-synced"], [data-testid="calendar-sync-group-view"], [data-testid="calendar-sync-group-all"], [data-testid="calendar-sync-connect"]'
      )
      .map((el) => el.attributes('data-testid'));
    expect(order).toEqual([
      'calendar-sync-group-synced',
      'calendar-sync-group-view',
      'calendar-sync-group-all',
      'calendar-sync-connect',
    ]);
  });

  it('"(push only)" opens the sync help article with a name that says where it goes', async () => {
    const wrapper = mountDrawer();
    const link = wrapper.get('[data-testid="calendar-sync-push-only"]');
    expect(link.element.tagName).toBe('BUTTON');
    expect(link.text()).toBe('calendarSync.pushOnly.link');
    expect(link.attributes('aria-label')).toBe('calendarSync.pushOnly.ariaLabel');
    await link.trigger('click');
    expect(openExternal).toHaveBeenCalledWith(
      `${MARKETING_URL}/help/security/google-calendar-sync#push-only`
    );
  });

  it('with no synced calendar there is no synced heading or link', () => {
    flags.on = new Set(['viewOnlyCalendars']);
    mockStore.connections = [];
    viewStore.calendars = [{ ...VIEWED }];
    const wrapper = mountDrawer();
    expect(wrapper.find('[data-testid="calendar-sync-group-synced"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-sync-push-only"]').exists()).toBe(false);
  });
});
