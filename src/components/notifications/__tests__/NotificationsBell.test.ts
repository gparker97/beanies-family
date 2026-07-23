import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const open = vi.fn();
const close = vi.fn();
const state = { isOpen: false, hasUnread: true, unreadCount: 1, open, close };

vi.mock('@/stores/notificationsStore', () => ({ useNotificationsStore: () => state }));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ remindersEnabled: true }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ pulse: vi.fn() }),
}));

import NotificationsBell from '../NotificationsBell.vue';

beforeEach(() => {
  open.mockClear();
  close.mockClear();
  state.isOpen = false;
  state.hasUnread = true;
  state.unreadCount = 1;
});

describe('NotificationsBell', () => {
  it('shows the unread ring-lines when there are unread notifications', () => {
    const wrapper = mount(NotificationsBell);
    expect(wrapper.find('[aria-label="notifications.unread"]').exists()).toBe(true);
  });

  it('hides the ring-lines when nothing is unread', () => {
    state.hasUnread = false;
    const wrapper = mount(NotificationsBell);
    expect(wrapper.find('[aria-label="notifications.unread"]').exists()).toBe(false);
  });

  it('toggles the drawer open / closed', async () => {
    const wrapper = mount(NotificationsBell);
    await wrapper.get('button').trigger('click');
    expect(open).toHaveBeenCalledTimes(1);

    state.isOpen = true;
    await wrapper.get('button').trigger('click');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
