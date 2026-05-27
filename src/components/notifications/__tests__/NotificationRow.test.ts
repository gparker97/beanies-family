import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import type { AppNotification } from '@/types/notifications';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// Mock the en/beanie picker so the row test needs no Pinia (the real one reads
// settingsStore); none of these cases use a release `summary` anyway.
vi.mock('@/composables/useBeanieText', () => ({
  useBeanieText: () => ({ txt: (v: { en: string; beanie: string }) => v.en }),
}));

import NotificationRow from '../NotificationRow.vue';

function notif(o: Partial<AppNotification>): AppNotification {
  return {
    id: 'n1',
    kind: 'todo-due',
    title: 'Buy milk',
    occurredAt: new Date().toISOString(),
    eventDate: '2026-05-27',
    eventTime: '16:00',
    read: false,
    ...o,
  };
}

describe('NotificationRow', () => {
  it('shows the bold title, the kind emoji, an at-a-glance summary + when, and an unread pip', () => {
    const wrapper = mount(NotificationRow, { props: { notification: notif({}) } });
    expect(wrapper.text()).toContain('Buy milk');
    expect(wrapper.text()).toContain('✅'); // todo-due icon
    expect(wrapper.text()).toContain('notifications.yourTask'); // summary fallback for a todo-due
    expect(wrapper.text()).toContain('notifications.due'); // the "Due …" when-line prefix
    expect(wrapper.find('[aria-label="notifications.unread"]').exists()).toBe(true);
  });

  it('renders the duty role chip for an activity drop-off', () => {
    const wrapper = mount(NotificationRow, {
      props: {
        notification: notif({
          kind: 'activity-reminder',
          subtitle: 'Lucas · Pool',
          dutyRole: 'dropoff',
        }),
      },
    });
    expect(wrapper.text()).toContain('Lucas · Pool');
    expect(wrapper.text()).toContain('notifications.youDropoff');
  });

  it('tapping the body emits select; tapping the pip emits toggle-read (separate actions)', async () => {
    const wrapper = mount(NotificationRow, { props: { notification: notif({}) } });
    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click'); // body
    expect(wrapper.emitted('select')?.[0]).toEqual(['n1']);
    await buttons[1].trigger('click'); // pip
    expect(wrapper.emitted('toggle-read')?.[0]).toEqual(['n1']);
  });

  it('a read row shows the hollow ring (no unread pip aria)', () => {
    const wrapper = mount(NotificationRow, { props: { notification: notif({ read: true }) } });
    expect(wrapper.find('[aria-label="notifications.unread"]').exists()).toBe(false);
  });
});
