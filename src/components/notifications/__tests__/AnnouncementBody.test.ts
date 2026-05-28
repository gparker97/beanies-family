import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Announcement } from '@/content/announcements';
import type { AppNotification } from '@/types/notifications';

const { push, close, openExternal, getAnnouncement } = vi.hoisted(() => ({
  push: vi.fn(),
  close: vi.fn(),
  openExternal: vi.fn(),
  getAnnouncement: vi.fn(),
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/stores/notificationsStore', () => ({ useNotificationsStore: () => ({ close }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useBeanieText', () => ({
  useBeanieText: () => ({ txt: (v: { en: string; beanie: string }) => v.en }),
}));
vi.mock('@/utils/openExternal', () => ({ openExternal }));
vi.mock('@/content/announcements', () => ({ getAnnouncement }));

import AnnouncementBody from '../AnnouncementBody.vue';

const bilingual = (s: string) => ({ en: s, beanie: s.toLowerCase() });

const discord: Announcement = {
  id: 'discord-community-2026-05',
  date: '2026-05-28',
  month: '28 may 2026',
  icon: '💬',
  kicker: bilingual('A note from greg'),
  title: bilingual('Join us on Discord!'),
  message: bilingual('Join me on Discord for feedback and bugs.'),
  note: bilingual('The link expires after a number of uses.'),
  cta: { label: bilingual('Join us on Discord'), href: 'https://discord.gg/NE4grWzjxV' },
};

const note: AppNotification = {
  id: 'announcement:discord-community-2026-05',
  kind: 'announcement',
  title: '28 may 2026',
  occurredAt: '2026-05-28T00:00:00.000Z',
  sourceId: 'discord-community-2026-05',
  read: false,
};

beforeEach(() => getAnnouncement.mockReset());

describe('AnnouncementBody', () => {
  it('renders the kicker, title, message, note and a CTA button', () => {
    getAnnouncement.mockReturnValue(discord);
    const w = mount(AnnouncementBody, { props: { notification: note } });
    expect(w.find('.wn-kick').text()).toContain('A note from greg');
    expect(w.find('.ann-title').text()).toBe('Join us on Discord!');
    expect(w.find('.ann-message').text()).toContain('Join me on Discord');
    expect(w.find('.ann-note').text()).toContain('expires');
    expect(w.find('.ann-cta').text()).toContain('Join us on Discord');
  });

  it('an external CTA opens via openExternal (no router navigation)', async () => {
    getAnnouncement.mockReturnValue(discord);
    const w = mount(AnnouncementBody, { props: { notification: note } });
    await w.find('.ann-cta').trigger('click');
    expect(openExternal).toHaveBeenCalledWith('https://discord.gg/NE4grWzjxV');
    expect(push).not.toHaveBeenCalled();
  });

  it('an internal CTA navigates + closes the drawer', async () => {
    getAnnouncement.mockReturnValue({
      ...discord,
      cta: { label: bilingual('Open the planner'), route: '/activities' },
    });
    const w = mount(AnnouncementBody, { props: { notification: note } });
    await w.find('.ann-cta').trigger('click');
    expect(close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/activities');
  });

  it('falls back to the kind label when no kicker, and hides the note + CTA when absent', () => {
    getAnnouncement.mockReturnValue({
      id: 'x',
      date: '2026-05-28',
      month: '28 may 2026',
      title: bilingual('Heads up'),
      message: bilingual('Something to know.'),
    });
    const w = mount(AnnouncementBody, { props: { notification: note } });
    expect(w.find('.wn-kick').text()).toContain('notifications.kindAnnouncement');
    expect(w.find('.ann-note').exists()).toBe(false);
    expect(w.find('.ann-cta').exists()).toBe(false);
  });
});
