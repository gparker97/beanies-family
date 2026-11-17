/**
 * CalendarConnectModal, the add step (view-only calendars plan 2026-11-17, P2):
 * consent first, then a single choice of calendar. Nothing is written until
 * "Connect Calendar"; any way out abandons the pending consent.
 *
 * P6: with `viewOnlyCalendars` on, the role cards ("Sync from beanies.family" /
 * "View only"), the view account step and the view-only sentences. With the flag
 * off every P2 test below runs unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import CalendarConnectModal from '../CalendarConnectModal.vue';
import { showToast } from '@/composables/useToast';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const flags = vi.hoisted(() => ({ viewOnly: false }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (name: string) => name === 'viewOnlyCalendars' && flags.viewOnly,
}));

const CALENDARS = [
  { id: 'me@example.com', summary: '', primary: true, accessRole: 'owner' },
  { id: 'kids', summary: 'Kids', primary: false, accessRole: 'writer' },
  { id: 'grandma', summary: 'Grandma', primary: false, accessRole: 'reader' },
  { id: 'work', summary: 'Work', primary: false, accessRole: 'freeBusyReader' },
  { id: 'family', summary: 'Family', primary: false, accessRole: 'owner' },
];

const store = reactive({
  connections: [] as Array<{
    id: string;
    accountEmail: string;
    destinationCalendarId: string;
    status?: 'ok' | 'disconnecting';
  }>,
  /** What the real store reads from the doc: every connection and every viewed calendar. */
  get calendarUses() {
    return {
      connections: this.connections.map((c) => ({ status: 'ok' as const, ...c })),
      viewed: viewStore.calendars.map((c) => ({
        calendarId: c.calendarId,
        accountEmail: undefined,
      })),
    };
  },
  pendingConnect: null as { accountEmail: string | null } | null,
  beginConnect: vi.fn(),
  listPendingCalendars: vi.fn(),
  confirmConnect: vi.fn(),
  abandonConnect: vi.fn(),
});
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => store }));

const viewStore = reactive({
  accounts: [] as Array<{ id: string; accountEmail: string }>,
  calendars: [] as Array<{ id: string; calendarId: string }>,
  pendingViewConnect: null as { accountEmail: string | null } | null,
  beginViewConnect: vi.fn(),
  listPendingViewCalendars: vi.fn(),
  listCalendarsForAccount: vi.fn(),
  addViewedCalendar: vi.fn(),
  abandonViewConnect: vi.fn(),
});
const useCalendarViewStore = vi.fn(() => viewStore);
vi.mock('@/stores/calendarViewStore', () => ({
  useCalendarViewStore: () => useCalendarViewStore(),
}));

// The stores are shared reactive mocks: a step left mounted by an earlier test
// would keep watching them and react to the next test's consent.
enableAutoUnmount(afterEach);

function mountModal(props: { canAddViewOnly?: boolean } = {}) {
  return mount(CalendarConnectModal, {
    props,
    global: {
      stubs: {
        // Renders the body plus the two footer actions the drawer would show.
        BeanieFormModal: {
          props: ['saveLabel', 'saveDisabled', 'isSubmitting'],
          emits: ['save', 'close'],
          template: `<div>
            <slot />
            <slot name="footer-start" />
            <button data-testid="save" :disabled="saveDisabled || isSubmitting" @click="$emit('save')">{{ saveLabel }}</button>
            <button data-testid="x" @click="$emit('close')">x</button>
          </div>`,
        },
        BaseButton: {
          emits: ['click'],
          template: '<button data-testid="cancel" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

function row(wrapper: ReturnType<typeof mountModal>, id: string) {
  return wrapper.get(`[data-testid="calendar-connect-row-${id}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.viewOnly = false;
  store.connections = [];
  store.pendingConnect = null;
  viewStore.accounts = [];
  viewStore.calendars = [];
  viewStore.pendingViewConnect = null;
  viewStore.beginViewConnect.mockImplementation(async () => {
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    return { status: 'pending' };
  });
  viewStore.listPendingViewCalendars.mockResolvedValue({ status: 'ok', calendars: CALENDARS });
  viewStore.listCalendarsForAccount.mockResolvedValue({ status: 'ok', calendars: CALENDARS });
  viewStore.addViewedCalendar.mockImplementation(async () => {
    viewStore.pendingViewConnect = null;
    return { status: 'added', viewedCalendarId: 'v1' };
  });
  store.beginConnect.mockImplementation(async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    return { status: 'pending' };
  });
  store.listPendingCalendars.mockResolvedValue(CALENDARS);
  store.confirmConnect.mockImplementation(async () => {
    store.pendingConnect = null;
    return { status: 'connected' };
  });
});

describe('CalendarConnectModal', () => {
  it('starts at a single Continue with Google action, then lists the account’s calendars', async () => {
    const wrapper = mountModal();
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="save"]').text()).toBe('calendarSync.connect.continue');

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(store.beginConnect).toHaveBeenCalledOnce();
    expect(store.listPendingCalendars).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="save"]').text()).toBe('calendarSync.connect.confirm');
    expect(wrapper.text()).toContain('calendarSync.primaryCalendar'); // the untitled primary
  });

  it('disables calendars it cannot sync to, each with its one-line reason', async () => {
    store.connections = [
      { id: 'c1', accountEmail: 'dad@example.com', destinationCalendarId: 'family' },
    ];
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    for (const id of ['grandma', 'work']) {
      expect(row(wrapper, id).get('input').attributes('disabled')).toBeDefined();
      expect(row(wrapper, id).text()).toContain('calendarSync.connect.reason.viewOnly');
    }
    expect(row(wrapper, 'family').get('input').attributes('disabled')).toBeDefined();
    expect(row(wrapper, 'family').text()).toContain('calendarSync.connect.reason.alreadyConnected');
    expect(row(wrapper, 'kids').get('input').attributes('disabled')).toBeUndefined();
  });

  it('treats a "primary" destination of the same account as already connected', async () => {
    store.connections = [
      { id: 'c1', accountEmail: 'Me@Example.com', destinationCalendarId: 'primary' },
    ];
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    expect(row(wrapper, 'me@example.com').text()).toContain(
      'calendarSync.connect.reason.alreadyConnected'
    );
    // Review round 3, T4: never another calendar in the primary's place (it used to
    // preselect the first eligible one, here a writable "Kids", so one tap pushed
    // every family activity into it). Nothing is chosen, and Connect waits.
    for (const id of ['kids', 'family']) {
      expect((row(wrapper, id).get('input').element as HTMLInputElement).checked).toBe(false);
    }
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="save"]').trigger('click');
    expect(store.confirmConnect).not.toHaveBeenCalled();

    await row(wrapper, 'family').get('input').setValue(true);
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.confirmConnect).toHaveBeenCalledWith('family', 'Family');
  });

  it('T4: with the primary eligible it is preselected (the usual destination)', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();
    expect((row(wrapper, 'me@example.com').get('input').element as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('T2: a fallback primary row is already connected when that primary is viewed', async () => {
    flags.viewOnly = true;
    viewStore.calendars = [{ id: 'v1', calendarId: 'me@example.com' }];
    store.listPendingCalendars.mockResolvedValue([{ id: 'primary', summary: '', primary: true }]);
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();
    expect(row(wrapper, 'primary').text()).toContain(
      'calendarSync.connect.reason.alreadyConnected'
    );
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
  });

  it('confirms with the chosen calendar id, toasts and closes', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    // The primary calendar is preselected; pick another.
    await row(wrapper, 'kids').get('input').setValue(true);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(store.confirmConnect).toHaveBeenCalledWith('kids', 'Kids');
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarSync.toast.connected.title',
      'calendarSync.toast.connected.message'
    );
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('a failed confirm stays open and offers Try again', async () => {
    store.confirmConnect.mockResolvedValue({ status: 'failed', reason: 'write-failed' });
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(store.confirmConnect).toHaveBeenCalledWith('me@example.com', undefined);
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.connectFailed.title',
      'calendarSync.toast.confirmFailed.message',
      expect.objectContaining({ actionLabel: 'action.tryAgain', actionFn: expect.any(Function) })
    );
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('Cancel abandons the pending consent and closes', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    await wrapper.get('[data-testid="cancel"]').trigger('click');

    expect(store.abandonConnect).toHaveBeenCalled();
    expect(store.confirmConnect).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closing the drawer abandons too, and so does unmounting it', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    await wrapper.get('[data-testid="x"]').trigger('click');
    expect(store.abandonConnect).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(store.abandonConnect).toHaveBeenCalledTimes(2); // a no-op in the store by then
  });

  it('a redirect return (consent already pending) opens straight at the calendar list', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal();
    await flushPromises();

    expect(store.beginConnect).not.toHaveBeenCalled();
    expect(store.listPendingCalendars).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
  });

  it('a consent that arrives while the step is open (native round trip) moves to the list', async () => {
    const wrapper = mountModal();
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(true);

    store.pendingConnect = { accountEmail: 'me@example.com' };
    await flushPromises();

    expect(store.listPendingCalendars).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
  });

  it('the popup path lists the calendars exactly once', async () => {
    const wrapper = mountModal();
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(store.listPendingCalendars).toHaveBeenCalledOnce();
  });

  it('a declined permission toasts with Try again and stays on the consent step', async () => {
    store.beginConnect.mockResolvedValue({
      status: 'failed',
      code: 'missing_scope',
      message: 'not granted',
    });
    const wrapper = mountModal();

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    // Translated copy from the shared mapper, never calendarAuth's English message.
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarSync.toast.connectFailed.title',
      'calendarSync.connect.syncMissingScope',
      expect.objectContaining({ silent: true, actionLabel: 'action.tryAgain' })
    );
    expect(store.listPendingCalendars).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(true);
  });

  it('a cancelled consent shows nothing', async () => {
    store.beginConnect.mockResolvedValue({ status: 'failed', code: 'cancelled', message: '' });
    const wrapper = mountModal();

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('CalendarConnectModal, view only (flag on)', () => {
  beforeEach(() => {
    flags.viewOnly = true;
  });

  async function chooseView(wrapper: ReturnType<typeof mountModal>) {
    await wrapper.get('[data-testid="calendar-connect-role-view"] input').trigger('change');
  }

  it('with the flag off there are no role cards and the view store is never created', () => {
    flags.viewOnly = false;
    const wrapper = mountModal({ canAddViewOnly: true });
    expect(wrapper.find('[data-testid="calendar-connect-roles"]').exists()).toBe(false);
    expect(useCalendarViewStore).not.toHaveBeenCalled();
  });

  it('offers the two role cards, Sync by default, only to a member who may add', () => {
    expect(mountModal().find('[data-testid="calendar-connect-roles"]').exists()).toBe(false);

    const wrapper = mountModal({ canAddViewOnly: true });
    expect(wrapper.find('[data-testid="calendar-connect-roles"]').exists()).toBe(true);
    const sync = wrapper.get('[data-testid="calendar-connect-role-sync"] input');
    expect((sync.element as HTMLInputElement).checked).toBe(true);
    // Sync keeps P2's consent sentence and shows neither view-only sentence.
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="calendar-connect-breadth"]').exists()).toBe(false);
  });

  it('view only with no account: the breadth sentence, then consent, list and add', async () => {
    const wrapper = mountModal({ canAddViewOnly: true });
    await chooseView(wrapper);

    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="calendar-connect-breadth"]').text()).toBe(
      'calendarSync.connect.viewBreadth'
    );
    expect(wrapper.get('[data-testid="save"]').text()).toBe('calendarSync.connect.continue');

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(viewStore.beginViewConnect).toHaveBeenCalledWith(undefined);
    expect(store.beginConnect).not.toHaveBeenCalled();
    expect(viewStore.listPendingViewCalendars).toHaveBeenCalledOnce();
    // Every access level can be viewed, and each row says which it is.
    for (const id of ['grandma', 'work', 'kids']) {
      expect(row(wrapper, id).get('input').attributes('disabled')).toBeUndefined();
    }
    expect(row(wrapper, 'grandma').text()).toContain('calendarSync.connect.access.reader');
    expect(row(wrapper, 'work').text()).toContain('calendarSync.connect.access.freeBusy');
    expect(row(wrapper, 'kids').text()).toContain('calendarSync.connect.access.edit');
    expect(wrapper.get('[data-testid="calendar-connect-reminder"]').text()).toBe(
      'calendarSync.connect.viewReminder'
    );

    await row(wrapper, 'grandma').get('input').setValue(true);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(viewStore.addViewedCalendar).toHaveBeenCalledWith({
      viewAccountId: 'pending',
      calendar: CALENDARS[2],
    });
    expect(store.confirmConnect).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'success',
      'calendarView.toast.added.title',
      'calendarView.toast.added.message'
    );
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('disables a calendar already synced to or already viewed, on either role', async () => {
    store.connections = [
      { id: 'c1', accountEmail: 'dad@example.com', destinationCalendarId: 'family' },
    ];
    viewStore.calendars = [{ id: 'v1', calendarId: 'grandma' }];
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();

    for (const id of ['family', 'grandma']) {
      expect(row(wrapper, id).get('input').attributes('disabled')).toBeDefined();
      expect(row(wrapper, id).text()).toContain('calendarSync.connect.reason.alreadyConnected');
    }

    // The sync list refuses the viewed calendar as already connected too.
    await wrapper.get('[data-testid="calendar-connect-role-sync"] input').trigger('change');
    store.pendingConnect = { accountEmail: 'me@example.com' };
    await flushPromises();
    expect(row(wrapper, 'grandma').text()).toContain(
      'calendarSync.connect.reason.alreadyConnected'
    );
    expect(wrapper.find('[data-testid="calendar-connect-reminder"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-connect-breadth"]').exists()).toBe(false);
  });

  it('offers known view accounts, and lists the chosen one’s calendars', async () => {
    viewStore.accounts = [{ id: 'a1', accountEmail: 'family@example.com' }];
    const wrapper = mountModal({ canAddViewOnly: true });
    await chooseView(wrapper);

    expect(wrapper.get('[data-testid="calendar-connect-account-a1"]').text()).toContain(
      'family@example.com'
    );
    expect(wrapper.find('[data-testid="calendar-connect-account-different"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="calendar-connect-breadth"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="save"]').text()).toBe('calendarSync.connect.next');

    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(viewStore.listCalendarsForAccount).toHaveBeenCalledWith('a1');
    expect(viewStore.beginViewConnect).not.toHaveBeenCalled();

    await row(wrapper, 'grandma').get('input').setValue(true);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(viewStore.addViewedCalendar).toHaveBeenCalledWith({
      viewAccountId: 'a1',
      calendar: CALENDARS[2],
    });
  });

  it('"Use a Different Google Account" starts a fresh view consent', async () => {
    viewStore.accounts = [{ id: 'a1', accountEmail: 'family@example.com' }];
    const wrapper = mountModal({ canAddViewOnly: true });
    await chooseView(wrapper);
    await wrapper.get('[data-testid="calendar-connect-account-different"] input').setValue(true);

    expect(wrapper.find('[data-testid="calendar-connect-breadth"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="save"]').text()).toBe('calendarSync.connect.continue');
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(viewStore.beginViewConnect).toHaveBeenCalledOnce();
    expect(viewStore.listPendingViewCalendars).toHaveBeenCalledOnce();
  });

  it('a declined view permission toasts what was not granted, with Try Again', async () => {
    viewStore.beginViewConnect.mockResolvedValue({
      status: 'failed',
      code: 'missing_scope',
      message: 'english text',
    });
    const wrapper = mountModal({ canAddViewOnly: true });
    await chooseView(wrapper);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarView.toast.connectFailed.title',
      'calendarSync.connect.viewMissingScope',
      expect.objectContaining({ silent: true, actionLabel: 'action.tryAgain' })
    );
    expect(viewStore.listPendingViewCalendars).not.toHaveBeenCalled();
  });

  it('Cancel abandons the view consent, not the sync one', async () => {
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();

    await wrapper.get('[data-testid="cancel"]').trigger('click');
    expect(viewStore.abandonViewConnect).toHaveBeenCalledOnce();
    expect(store.abandonConnect).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('switching role after a consent abandons the other role’s consent', async () => {
    store.pendingConnect = { accountEmail: 'me@example.com' };
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);

    await chooseView(wrapper);
    expect(store.abandonConnect).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(false);

    await wrapper.get('[data-testid="calendar-connect-role-sync"] input').trigger('change');
    expect(viewStore.abandonViewConnect).toHaveBeenCalledOnce();
  });

  it('a returning view redirect opens with View only selected, at the calendar list', async () => {
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();

    const view = wrapper.get('[data-testid="calendar-connect-role-view"] input');
    expect((view.element as HTMLInputElement).checked).toBe(true);
    expect(viewStore.beginViewConnect).not.toHaveBeenCalled();
    expect(viewStore.listPendingViewCalendars).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('calendarSync.connect.account');
  });

  it('a pending consent that cannot list its calendars is abandoned, with Try Again', async () => {
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    viewStore.listPendingViewCalendars.mockResolvedValue({
      status: 'failed',
      reason: 'no-list-scope',
    });
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();

    expect(viewStore.abandonViewConnect).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarView.toast.connectFailed.title',
      'calendarSync.connect.viewNoListScope',
      expect.objectContaining({ actionLabel: 'action.tryAgain' })
    );
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(false);
  });

  it('L3: a list read that failed keeps the consent and offers Try Again, which reads the list again', async () => {
    viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
    viewStore.listPendingViewCalendars.mockResolvedValueOnce({
      status: 'failed',
      reason: 'read-failed',
    });
    const wrapper = mountModal({ canAddViewOnly: true });
    await flushPromises();

    expect(viewStore.abandonViewConnect).not.toHaveBeenCalled();
    const call = vi
      .mocked(showToast)
      .mock.calls.find(([, , message]) => message === 'calendarView.toast.listFailed.message');
    expect(call?.[3]).toMatchObject({ silent: true, actionLabel: 'action.tryAgain' });

    (call![3] as { actionFn: () => void }).actionFn();
    await flushPromises();
    expect(viewStore.listPendingViewCalendars).toHaveBeenCalledTimes(2);
    expect(viewStore.beginViewConnect).not.toHaveBeenCalled(); // no new sign-in
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
  });

  it('L2: a list that resolves after the member switched role does not move the step', async () => {
    viewStore.accounts = [{ id: 'a1', accountEmail: 'family@example.com' }];
    let resolveList!: (v: unknown) => void;
    store.listPendingCalendars.mockReturnValueOnce(new Promise((r) => (resolveList = r)));
    const wrapper = mountModal({ canAddViewOnly: true });
    await wrapper.get('[data-testid="save"]').trigger('click'); // sync consent, then listing
    await flushPromises();
    expect(store.listPendingCalendars).toHaveBeenCalledOnce();

    await chooseView(wrapper); // the sync consent is abandoned; View only starts at its accounts
    expect(wrapper.find('[data-testid="calendar-connect-account-a1"]').exists()).toBe(true);
    store.pendingConnect = null;
    resolveList(CALENDARS);
    await flushPromises();

    expect(wrapper.find('[data-testid="calendar-connect-account-a1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="calendar-connect-consent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(false);
  });

  it('R6: a superseded sync list never clears the busy of a view consent started meanwhile', async () => {
    let resolveList!: (v: unknown) => void;
    store.listPendingCalendars.mockReturnValueOnce(new Promise((r) => (resolveList = r)));
    let resolveConsent!: () => void;
    viewStore.beginViewConnect.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveConsent = () => {
            viewStore.pendingViewConnect = { accountEmail: 'family@example.com' };
            r({ status: 'pending' });
          };
        })
    );
    const wrapper = mountModal({ canAddViewOnly: true });
    await wrapper.get('[data-testid="save"]').trigger('click'); // sync consent, then listing
    await flushPromises();
    await chooseView(wrapper); // no view account: straight to the consent step
    store.pendingConnect = null;
    await wrapper.get('[data-testid="save"]').trigger('click'); // the view popup is open
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();

    // The superseded sync list lands while the view popup is still open.
    resolveList(CALENDARS);
    await flushPromises();
    expect(wrapper.get('[data-testid="save"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="x"]').trigger('click'); // cannot close mid-popup
    expect(wrapper.emitted('close')).toBeUndefined();

    resolveConsent();
    await flushPromises();
    // One list read for the one consent (the pending watch did not read a second time).
    expect(viewStore.listPendingViewCalendars).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(true);
  });

  it('L1: an add whose account vanished tells the member and starts again', async () => {
    viewStore.accounts = [{ id: 'a1', accountEmail: 'family@example.com' }];
    viewStore.addViewedCalendar.mockResolvedValueOnce({ status: 'failed', reason: 'no-account' });
    const wrapper = mountModal({ canAddViewOnly: true });
    await chooseView(wrapper);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    await row(wrapper, 'grandma').get('input').setValue(true);
    await wrapper.get('[data-testid="save"]').trigger('click');
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      'error',
      'calendarView.toast.saveFailed.title',
      'calendarView.toast.accountGone.message',
      { silent: true }
    );
    expect(wrapper.find('[data-testid="calendar-connect-list"]').exists()).toBe(false);
  });
});
