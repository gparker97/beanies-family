import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import type { ReleaseNote } from '@/content/release-notes';

const { push, close, openExternal } = vi.hoisted(() => ({
  push: vi.fn(),
  close: vi.fn(),
  openExternal: vi.fn(),
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
vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://beanies.family' }));

import WhatsNewBody from '../WhatsNewBody.vue';

const bilingual = (s: string) => ({ en: s, beanie: s.toLowerCase() });

const base: ReleaseNote = { version: '2026.05.27', date: '2026-05-27', month: '27 may 2026' };

const single: ReleaseNote = {
  ...base,
  summary: bilingual('Notifications are here!'),
  features: [
    {
      icon: '🔔',
      title: bilingual('Notifications are here!'),
      description: bilingual('A bell that keeps track of what needs you.'),
    },
  ],
};

const multi: ReleaseNote = {
  ...base,
  features: [
    {
      title: bilingual('More room'),
      description: bilingual('The calendar sits flush.'),
      tryItRoute: '/activities',
    },
    { title: bilingual('Update notes'), description: bilingual('Every update leaves a note.') },
    { title: bilingual('A gift'), description: bilingual('Updates feel like a celebration.') },
  ],
};

describe('WhatsNewBody — headline + detail blocks', () => {
  it('single feature: centred block with lead emoji, headline + detail, no update count', () => {
    const w = mount(WhatsNewBody, { props: { release: single } });
    expect(w.find('.wn-list.single').exists()).toBe(true);
    expect(w.find('.wn-item-emoji').text()).toBe('🔔');
    expect(w.find('.wn-item-title').text()).toBe('Notifications are here!');
    expect(w.find('.wn-item-desc').text()).toContain('keeps track of what needs you');
    expect(w.find('.wn-message').exists()).toBe(false);
    expect(w.find('.wn-kick').text()).not.toContain('whatsNew.updateCount');
  });

  it('multiple features: a beanstalk list (no single class), one block each, with the update count', () => {
    const w = mount(WhatsNewBody, { props: { release: multi } });
    const list = w.find('.wn-list');
    expect(list.exists()).toBe(true);
    expect(list.classes()).not.toContain('single');
    expect(w.findAll('.wn-item')).toHaveLength(3);
    // multi blocks have no centred lead emoji
    expect(w.find('.wn-item-emoji').exists()).toBe(false);
    expect(w.find('.wn-kick').text()).toContain('whatsNew.updateCount');
  });

  it('summary-only note (no features): falls back to the centred message', () => {
    const w = mount(WhatsNewBody, {
      props: { release: { ...base, summary: bilingual('Minor fixes and improvements.') } },
    });
    expect(w.find('.wn-message').text()).toBe('Minor fixes and improvements.');
    expect(w.find('.wn-list').exists()).toBe(false);
  });

  it('a feature with tryItRoute renders "try it" and navigates + closes the drawer on click', async () => {
    const w = mount(WhatsNewBody, { props: { release: multi } });
    const tryIt = w.find('.wn-tryit');
    expect(tryIt.exists()).toBe(true);
    await tryIt.trigger('click');
    expect(close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/activities');
  });

  it('"see all updates" opens the marketing whats-new page externally', async () => {
    const w = mount(WhatsNewBody, { props: { release: single } });
    await w.find('.wn-seeall').trigger('click');
    expect(openExternal).toHaveBeenCalledWith('https://beanies.family/help/whats-new');
  });
});
