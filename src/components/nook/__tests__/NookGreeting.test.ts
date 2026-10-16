import { enableAutoUnmount, mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';
import NookGreeting from '../NookGreeting.vue';
import { useTranslationStore } from '@/stores/translationStore';
import type { WeatherAtom, WeatherAtomReading } from '@/types/weather';
import { formatUiDate } from '@/utils/uiLocale';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  /** The injected layout: a candidate fits when its text is at most this long. */
  maxChars: { value: 1000 },
}));

const weather = reactive<{ atom: WeatherAtom | null }>({ atom: null });
const isDesktop = ref(false);
const today = ref('2026-10-16');

vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/stores/weatherStore', () => ({ useWeatherStore: () => weather }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { name: 'Dana' } }),
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ textSize: 'normal' }) }));
vi.mock('@/composables/useBreakpoint', () => ({ useBreakpoint: () => ({ isDesktop }) }));
vi.mock('@/composables/useToday', () => ({ useToday: () => ({ today }) }));
// jsdom has no layout: keep the real composable, inject the measurement.
vi.mock('@/composables/useFirstThatFits', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/composables/useFirstThatFits')>();
  return {
    useFirstThatFits: (
      ...[container, measurer, options]: Parameters<typeof real.useFirstThatFits>
    ) =>
      real.useFirstThatFits(container, measurer, {
        ...options,
        measure: (el: HTMLElement) => (el.textContent ?? '').length <= h.maxChars.value,
      }),
  };
});

function reading(overrides: Partial<WeatherAtomReading> = {}): WeatherAtomReading {
  return {
    state: 'reading',
    freshness: 'fresh',
    glyph: 'rain',
    temp: '55°',
    condition: 'Rain',
    high: '57°',
    low: '49°',
    highLow: 'H 57° L 49°',
    todayHighLow: 'Today H 57° L 49°',
    ageText: null,
    ageShort: null,
    soft: false,
    tonightLow: '44°',
    outlook: [],
    placeName: 'Portland',
    ...overrides,
  };
}

async function mountGreeting() {
  const wrapper = mount(NookGreeting, { global: { stubs: { RouterLink: RouterLinkStub } } });
  await flush();
  return wrapper;
}

/** The measure runs after the next DOM update. */
async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
  await nextTick();
}

const captionText = (wrapper: ReturnType<typeof mount>) =>
  wrapper.get('[data-testid="nook-caption-line"]').text();

function fitEvents() {
  return h.logEvent.mock.calls.filter(([e]) => e.message === 'nook_caption_fit');
}

enableAutoUnmount(afterEach);

describe('NookGreeting', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useTranslationStore().setBeanieMode(false);
    weather.atom = null;
    isDesktop.value = false;
    today.value = '2026-10-16';
    h.maxChars.value = 1000;
    h.logEvent.mockClear();
  });

  it('keeps the greeting, with the name in the accent', async () => {
    const wrapper = await mountGreeting();
    expect(wrapper.get('h1').text()).toBe('Welcome Home, Dana');
    const name = wrapper.get('h1 span');
    expect(name.text()).toBe('Dana');
    expect(name.classes()).toEqual(
      expect.arrayContaining(['text-primary-500', 'dark:text-accent-lift'])
    );
  });

  it.each<[string, WeatherAtom | null]>([
    ['weather off', null],
    ['no home town', { state: 'nudge' }],
    ['unavailable', { state: 'unavailable', errorCode: 'network' }],
    ['a reading over 12 hours old', reading({ freshness: 'old', temp: null })],
  ])('shows the plain caption, short date, no measurer: %s', async (_label, atom) => {
    weather.atom = atom;
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("It's Fri, Oct 16 · Your family at a glance");
    expect(wrapper.find('[data-testid="nook-caption-measurer"]').exists()).toBe(false);
    expect(fitEvents()).toHaveLength(0);
  });

  it('writes the plain caption in zh with a Chinese date', async () => {
    await useTranslationStore().loadTranslations('zh');
    const wrapper = await mountGreeting();
    const zhDate = formatUiDate('2026-10-16', 'zh', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    expect(captionText(wrapper)).toBe(`今天是 ${zhDate} · 全家近况一览`);
  });

  it('rolls the date when today changes on an open Nook', async () => {
    const wrapper = await mountGreeting();
    today.value = '2026-10-17';
    await flush();
    expect(captionText(wrapper)).toBe("It's Sat, Oct 17 · Your family at a glance");
  });

  it('speaks a fresh reading as one sentence with the long date when it fits', async () => {
    weather.atom = reading();
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("It's a rainy 55° Friday, October 16");
    expect(wrapper.text()).not.toContain('Your family at a glance');
  });

  it('speaks an aged reading too, and the clear-night sentence for night', async () => {
    weather.atom = reading({ freshness: 'aged', soft: true, glyph: 'night', temp: '49°' });
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("It's a clear 49° night on Friday, October 16");
  });

  it('takes the short date when the long one does not fit', async () => {
    weather.atom = reading();
    h.maxChars.value = 30;
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("It's a rainy 55° Fri, Oct 16");
  });

  it('falls back to the plain sentence, and to the last candidate when none fits', async () => {
    weather.atom = reading();
    h.maxChars.value = 20;
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("It's Fri, Oct 16");

    h.maxChars.value = 3;
    weather.atom = reading({ temp: '56°' });
    await flush();
    expect(captionText(wrapper)).toBe("It's Fri, Oct 16");
  });

  it('styles the date and the temperature by their token', async () => {
    weather.atom = reading();
    const wrapper = await mountGreeting();
    const spans = wrapper.findAll('[data-testid="nook-caption-line"] span');
    const date = spans.find((s) => s.text() === 'Friday, October 16')!;
    const temp = spans.find((s) => s.text() === '55°')!;
    expect(date.classes()).toEqual(
      expect.arrayContaining(['text-primary-500', 'dark:text-accent-lift', 'font-outfit'])
    );
    expect(temp.classes()).toEqual(
      expect.arrayContaining(['text-secondary-500', 'dark:text-ink', 'font-outfit'])
    );
  });

  it('draws the caption in the soft ink with no opacity modifier', async () => {
    const wrapper = await mountGreeting();
    const caption = wrapper.get('[data-testid="nook-caption"]');
    expect(caption.classes()).toEqual(
      expect.arrayContaining(['text-secondary-400', 'dark:text-ink-soft'])
    );
    expect(wrapper.html()).not.toMatch(/text-secondary-500\/\d+/);
  });

  it('lowercases the sentence in beanie mode and keeps the date capitals', async () => {
    useTranslationStore().setBeanieMode(true);
    weather.atom = reading();
    const wrapper = await mountGreeting();
    expect(captionText(wrapper)).toBe("it's a rainy 55° Friday, October 16");
  });

  it('uses the zh weather sentence under zh', async () => {
    await useTranslationStore().loadTranslations('zh');
    weather.atom = reading();
    const wrapper = await mountGreeting();
    const zhDate = formatUiDate('2026-10-16', 'zh', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    expect(captionText(wrapper)).toBe(`今天${zhDate}，有雨，55°`);
  });

  it('reports nook_caption_fit once per transition, across remounts', async () => {
    weather.atom = reading();
    h.maxChars.value = 30;
    (await mountGreeting()).unmount();
    h.maxChars.value = 20;
    const before = fitEvents().length;
    (await mountGreeting()).unmount();
    expect(fitEvents()).toHaveLength(before + 1);
    expect(fitEvents().at(-1)![0]).toMatchObject({
      level: 'info',
      surface: 'weather',
      context: { action: 'caption-fit', stage: 'plain', format: 'phone' },
    });
    // The same answer again is not news.
    (await mountGreeting()).unmount();
    expect(fitEvents()).toHaveLength(before + 1);
    h.maxChars.value = 1000;
    await mountGreeting();
    expect(fitEvents()).toHaveLength(before + 2);
    expect(fitEvents().at(-1)![0].context.stage).toBe('full');
  });

  describe('desktop', () => {
    beforeEach(() => {
      isDesktop.value = true;
    });

    it('shows the descriptor and the weather pill beside the greeting', async () => {
      weather.atom = reading();
      const wrapper = await mountGreeting();
      expect(wrapper.find('[data-testid="nook-caption"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Your family at a glance');
      expect(wrapper.find('[data-testid="nook-weather-pill"]').exists()).toBe(true);
      expect(wrapper.get('[data-testid="nook-greeting"]').classes()).toEqual(
        expect.arrayContaining(['@container', 'flex', 'justify-between'])
      );
      expect(fitEvents()).toHaveLength(0);
    });

    it('shows no pill with weather off', async () => {
      const wrapper = await mountGreeting();
      expect(wrapper.find('[data-testid="nook-weather-pill"]').exists()).toBe(false);
    });
  });
});
