import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Announcement } from '@/content/announcements';
import type { AppNotification } from '@/types/notifications';

const { getAnnouncement } = vi.hoisted(() => ({ getAnnouncement: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useBeanieText', () => ({
  useBeanieText: () => ({ txt: (v: { en: string; beanie: string }) => v.en }),
}));
vi.mock('@/content/announcements', () => ({ getAnnouncement }));

import AnnouncementCard from '../AnnouncementCard.vue';
import { isAnnouncementCard } from '../notificationKinds';

const bilingual = (s: string) => ({ en: s, beanie: s.toLowerCase() });

const discord: Announcement = {
  id: 'discord-community-2026-05',
  date: '2026-05-28',
  month: '28 may 2026',
  icon: '💬',
  kicker: bilingual('A note from greg'),
  title: bilingual('Join us on Discord!'),
  message: bilingual('…'),
};

const note: AppNotification = {
  id: 'announcement:discord-community-2026-05',
  kind: 'announcement',
  title: '28 may 2026', // language-agnostic fallback the deriver sets
  occurredAt: new Date().toISOString(),
  sourceId: 'discord-community-2026-05',
  read: false,
};

beforeEach(() => getAnnouncement.mockReset());

describe('AnnouncementCard', () => {
  it('shows the resolved kicker, bilingual title, icon and an unread pip', () => {
    getAnnouncement.mockReturnValue(discord);
    const w = mount(AnnouncementCard, { props: { notification: note } });
    expect(w.find('.stamp').text()).toBe('💬');
    expect(w.find('.kicker').text()).toBe('A note from greg');
    expect(w.find('.ann-title').text()).toBe('Join us on Discord!');
    expect(w.find('[aria-label="notifications.unread"]').exists()).toBe(true);
  });

  it('falls back to the kind label when the announcement has no kicker', () => {
    getAnnouncement.mockReturnValue({ ...discord, kicker: undefined });
    const w = mount(AnnouncementCard, { props: { notification: note } });
    expect(w.find('.kicker').text()).toBe('notifications.kindAnnouncement');
  });

  it('falls back to a default 📣 icon when the announcement has none', () => {
    getAnnouncement.mockReturnValue({ ...discord, icon: undefined });
    const w = mount(AnnouncementCard, { props: { notification: note } });
    expect(w.find('.stamp').text()).toBe('📣');
  });

  it('a read card shows no unread pip aria', () => {
    getAnnouncement.mockReturnValue(discord);
    const w = mount(AnnouncementCard, { props: { notification: { ...note, read: true } } });
    expect(w.find('[aria-label="notifications.unread"]').exists()).toBe(false);
  });

  it('emits select (body) and toggle-read (pip) as separate actions', async () => {
    getAnnouncement.mockReturnValue(discord);
    const w = mount(AnnouncementCard, { props: { notification: note } });
    const btns = w.findAll('button');
    await btns[0].trigger('click'); // body
    expect(w.emitted('select')?.[0]).toEqual([note.id]);
    await btns[1].trigger('click'); // pip
    expect(w.emitted('toggle-read')?.[0]).toEqual([note.id]);
  });
});

describe('isAnnouncementCard', () => {
  it('true when the announcement resolves in the registry', () => {
    getAnnouncement.mockReturnValue(discord);
    expect(isAnnouncementCard(note)).toBe(true);
  });

  it('false for a non-announcement kind', () => {
    expect(isAnnouncementCard({ ...note, kind: 'todo-due' })).toBe(false);
  });

  it('false for an announcement with no resolvable content (orphan)', () => {
    getAnnouncement.mockReturnValue(undefined);
    expect(isAnnouncementCard({ ...note, sourceId: 'does-not-exist' })).toBe(false);
  });

  it('false when sourceId is missing', () => {
    expect(isAnnouncementCard({ ...note, sourceId: undefined })).toBe(false);
  });
});
