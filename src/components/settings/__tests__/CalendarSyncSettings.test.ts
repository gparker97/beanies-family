/**
 * CalendarSyncSettings — error-handling contract for the two actions whose
 * underlying store methods swallow failures into connection status. The view must
 * toast the REAL outcome, never an unconditional success. Covers the fixes made
 * when Google Calendar graduated from The Beanie Lab (2026-07-03).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import CalendarSyncSettings from '../CalendarSyncSettings.vue';
import { showToast } from '@/composables/useToast';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn(async () => true) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => false }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    calendarClashNudgeEnabled: false,
    setCalendarClashNudgeEnabled: vi.fn(),
  }),
}));

const syncNow = vi.fn();
const disconnect = vi.fn();
const mockStore = {
  connections: [
    { id: 'c1', accountEmail: 'a@b.com', status: 'ok', destinationCalendarId: 'primary' },
  ],
  isConnectSupported: true,
  syncNow,
  disconnect,
  connect: vi.fn(),
  reconnect: vi.fn(),
  setDestinationCalendar: vi.fn(),
  listCalendarsFor: vi.fn(async () => []),
};
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => mockStore }));

function mountDrawer() {
  return mount(CalendarSyncSettings, {
    props: { open: true },
    global: {
      stubs: {
        BeanieFormModal: { template: '<div><slot /></div>' },
        BaseSelect: true,
        SettingToggleRow: true,
        BaseButton: {
          emits: ['click'],
          template: '<button class="bb" @click="$emit(\'click\')"><slot /></button>',
        },
      },
    },
  });
}

/** Find a stubbed BaseButton by its slotted i18n-key text. */
function button(wrapper: ReturnType<typeof mountDrawer>, key: string) {
  return wrapper.findAll('button.bb').find((b) => b.text().includes(key))!;
}

beforeEach(() => vi.clearAllMocks());

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
