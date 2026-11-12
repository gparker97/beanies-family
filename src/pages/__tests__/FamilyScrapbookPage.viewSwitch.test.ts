/** The Spreads / Timeline switch: persists per device and swaps the body of the page. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import FamilyScrapbookPage from '@/pages/FamilyScrapbookPage.vue';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {}, path: '/pod/scrapbook' }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const mountPage = () => shallowMount(FamilyScrapbookPage);

describe('FamilyScrapbookPage view switch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('opens on spreads, switches to the timeline, logs and remembers it', async () => {
    const w = mountPage();
    expect(w.findComponent({ name: 'ScrapbookTimeline' }).exists()).toBe(false);
    expect(w.findComponent({ name: 'ScrapbookSpine' }).exists()).toBe(true);

    w.findComponent({ name: 'TogglePillGroup' }).vm.$emit('update:modelValue', 'timeline');
    await nextTick();

    expect(w.findComponent({ name: 'ScrapbookTimeline' }).exists()).toBe(true);
    expect(w.findComponent({ name: 'ScrapbookSpine' }).exists()).toBe(false);
    expect(localStorage.getItem('beanies:scrapbookView')).toBe('timeline');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'scrapbook_view_change', context: { kind: 'timeline' } })
    );
  });

  it('restores a stored timeline choice', () => {
    localStorage.setItem('beanies:scrapbookView', 'timeline');
    const w = mountPage();
    expect(w.findComponent({ name: 'ScrapbookTimeline' }).exists()).toBe(true);
  });

  it("gives the timeline the scroller's real visible height for its month rail", () => {
    localStorage.setItem('beanies:scrapbookView', 'timeline');
    const w = mountPage();
    // `.timeline-fit` (scoped) sets `--scrapbook-timeline-viewport` from `<main>`'s published
    // height less the phone tab bar, so the rail never falls back to the whole window.
    expect(w.findComponent({ name: 'ScrapbookTimeline' }).classes()).toContain('timeline-fit');
  });
});
