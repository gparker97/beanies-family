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
  // Assert the BUTTON's accessible name, not an attribute on an SVG <path>.
  // The ring-lines live inside an aria-hidden <svg>, so an aria-label there
  // reaches no screen reader — the previous assertions passed on markup that was
  // invisible to assistive tech, which is exactly how the regression hid.
  it('announces unread state on the button when there are unread notifications', () => {
    const wrapper = mount(NotificationsBell);
    expect(wrapper.get('button').attributes('aria-label')).toContain('notifications.unread');
  });

  it('shows the unread ring-lines when there are unread notifications', () => {
    const wrapper = mount(NotificationsBell);
    expect(wrapper.find('path[stroke="#F15D22"]').exists()).toBe(true);
  });

  it('hides the ring-lines and drops the unread announcement when nothing is unread', () => {
    state.hasUnread = false;
    const wrapper = mount(NotificationsBell);
    expect(wrapper.find('path[stroke="#F15D22"]').exists()).toBe(false);
    expect(wrapper.get('button').attributes('aria-label')).not.toContain('notifications.unread');
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
