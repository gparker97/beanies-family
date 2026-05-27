import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import type { AppNotification } from '@/types/notifications';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useBeanieText', () => ({
  useBeanieText: () => ({ txt: (v: { en: string; beanie: string }) => v.en }),
}));

import WhatsNewGiftCard from '../WhatsNewGiftCard.vue';
import { isCelebratoryWhatsNew } from '../notificationKinds';

const note: AppNotification = {
  id: 'whats-new:2026.05.27',
  kind: 'whats-new',
  title: 'Notifications are here!',
  occurredAt: new Date().toISOString(),
  sourceId: '2026.05.27', // not in the registry → summary falls back to the title
  read: false,
};

describe('WhatsNewGiftCard', () => {
  it('shows the what’s-new kicker + the summary, with an unread pip', () => {
    const w = mount(WhatsNewGiftCard, { props: { notification: note } });
    expect(w.text()).toContain('notifications.kindWhatsNew'); // the kicker
    expect(w.text()).toContain('Notifications are here!'); // summary (title fallback)
    expect(w.find('[aria-label="notifications.unread"]').exists()).toBe(true);
  });

  it('a read card shows no unread pip aria', () => {
    const w = mount(WhatsNewGiftCard, { props: { notification: { ...note, read: true } } });
    expect(w.find('[aria-label="notifications.unread"]').exists()).toBe(false);
  });

  it('emits select (body) and toggle-read (pip) as separate actions', async () => {
    const w = mount(WhatsNewGiftCard, { props: { notification: note } });
    const btns = w.findAll('button');
    await btns[0].trigger('click'); // body
    expect(w.emitted('select')?.[0]).toEqual(['whats-new:2026.05.27']);
    await btns[1].trigger('click'); // pip
    expect(w.emitted('toggle-read')?.[0]).toEqual(['whats-new:2026.05.27']);
  });
});

describe('isCelebratoryWhatsNew', () => {
  it('true for a spotlight release (the curated 2026.04 has feature cards)', () => {
    expect(isCelebratoryWhatsNew({ ...note, sourceId: '2026.04' })).toBe(true);
  });

  it('false for a non-whats-new kind', () => {
    expect(isCelebratoryWhatsNew({ ...note, kind: 'todo-due' })).toBe(false);
  });

  it('false for an unknown release version', () => {
    expect(isCelebratoryWhatsNew({ ...note, sourceId: 'does-not-exist' })).toBe(false);
  });
});
