import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const open = vi.fn();
const close = vi.fn();
const state = { isOpen: false, hasUnread: true, open, close };

vi.mock('@/stores/notificationsStore', () => ({ useNotificationsStore: () => state }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import NotificationsBell from '../NotificationsBell.vue';

beforeEach(() => {
  open.mockClear();
  close.mockClear();
  state.isOpen = false;
  state.hasUnread = true;
});

describe('NotificationsBell', () => {
  it('shows the unread dot when there are unread notifications', () => {
    const wrapper = mount(NotificationsBell);
    expect(wrapper.find('[aria-label="notifications.unread"]').exists()).toBe(true);
  });

  it('hides the dot when nothing is unread', () => {
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
