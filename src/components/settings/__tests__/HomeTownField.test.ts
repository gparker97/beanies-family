import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import type { WeatherPlace } from '@/types/models';
import type { WeatherAtom, WeatherSearchResult } from '@/types/weather';

const PORTLAND_OR: WeatherPlace = {
  id: 5746545,
  name: 'Portland',
  admin1: 'Oregon',
  country: 'United States',
  countryCode: 'US',
  lat: 45.52,
  lon: -122.68,
};
const PORTLAND_ME: WeatherPlace = {
  id: 4975802,
  name: 'Portland',
  admin1: 'Maine',
  country: 'United States',
  countryCode: 'US',
  lat: 43.66,
  lon: -70.26,
};

const settings = reactive({
  weatherPlace: null as WeatherPlace | null,
  setWeatherPlace: vi.fn(async (p: WeatherPlace | null) => {
    settings.weatherPlace = p;
  }),
});
const weather = reactive({
  atom: null as WeatherAtom | null,
  searchMinChars: 2,
  searchPlaces: vi.fn<(q: string, s?: AbortSignal) => Promise<WeatherSearchResult>>(),
});
const logEventMock = vi.fn();

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
vi.mock('@/stores/weatherStore', () => ({ useWeatherStore: () => weather }));
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEventMock(...a),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import HomeTownField from '../HomeTownField.vue';

const render = (props: Record<string, unknown> = {}) =>
  mount(HomeTownField, {
    props,
    attachTo: document.body,
    global: {
      stubs: {
        BeanieSpinner: { template: '<div data-test="spinner" />' },
        WeatherGlyph: { props: ['kind'], template: '<i data-test="glyph" :data-kind="kind" />' },
      },
    },
  });

async function type(wrapper: ReturnType<typeof render>, text: string) {
  await wrapper.get('[data-testid="home-town-input"]').setValue(text);
}

async function settle() {
  await vi.advanceTimersByTimeAsync(300);
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  settings.weatherPlace = null;
  settings.setWeatherPlace.mockClear();
  settings.setWeatherPlace.mockImplementation(async (p) => {
    settings.weatherPlace = p;
  });
  weather.atom = null;
  weather.searchPlaces.mockReset();
  weather.searchPlaces.mockResolvedValue({ ok: true, places: [PORTLAND_OR, PORTLAND_ME] });
  logEventMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('HomeTownField', () => {
  it('debounces typing into one search and shows a spinner meanwhile', async () => {
    const wrapper = render();
    await type(wrapper, 'Po');
    await type(wrapper, 'Por');
    await type(wrapper, 'Portl');
    expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
    expect(weather.searchPlaces).not.toHaveBeenCalled();
    await settle();
    expect(weather.searchPlaces).toHaveBeenCalledTimes(1);
    expect(weather.searchPlaces.mock.calls[0]![0]).toBe('Portl');
    expect(wrapper.find('[data-test="spinner"]').exists()).toBe(false);
  });

  it('never searches a single character', async () => {
    const wrapper = render();
    await type(wrapper, 'P');
    await settle();
    expect(weather.searchPlaces).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="home-town-listbox"]').exists()).toBe(false);
  });

  it('aborts the previous request when the text changes, and drops its late answer', async () => {
    let resolveFirst: (r: WeatherSearchResult) => void = () => {};
    weather.searchPlaces.mockImplementationOnce(
      () => new Promise<WeatherSearchResult>((r) => (resolveFirst = r))
    );
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    const firstSignal = weather.searchPlaces.mock.calls[0]![1]!;
    weather.searchPlaces.mockResolvedValueOnce({ ok: true, places: [] });
    await type(wrapper, 'Portlnad');
    expect(firstSignal.aborted).toBe(true);
    await settle();
    resolveFirst({ ok: true, places: [PORTLAND_OR] });
    await flushPromises();
    // The answer for "Portlnad" (not found) stands; the late "Portl" answer was dropped.
    expect(wrapper.find('[data-testid="home-town-listbox"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="home-town-message"]').text()).toBe(
      'settings.weather.notFound'
    );
  });

  it('aborts an in-flight request on unmount', async () => {
    weather.searchPlaces.mockImplementationOnce(() => new Promise(() => {}));
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    const signal = weather.searchPlaces.mock.calls[0]![1]!;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('lists suggestions with the typed text bolded and the country beneath', async () => {
    const wrapper = render();
    await type(wrapper, 'portl');
    await settle();
    const options = wrapper.findAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]!.get('b').text()).toBe('Portl');
    expect(options[0]!.text()).toContain('Portland, Oregon');
    expect(options[0]!.text()).toContain('United States');
    const input = wrapper.get('[data-testid="home-town-input"]');
    expect(input.attributes('aria-expanded')).toBe('true');
    expect(input.attributes('aria-controls')).toBe(
      wrapper.get('[role="listbox"]').attributes('id')
    );
  });

  it('shows the not-found line when the search finds nothing', async () => {
    weather.searchPlaces.mockResolvedValue({ ok: true, places: [] });
    const wrapper = render();
    await type(wrapper, 'Portlnad');
    await settle();
    expect(wrapper.get('[data-testid="home-town-message"]').text()).toBe(
      'settings.weather.notFound'
    );
  });

  it('shows the failure line when the search fails', async () => {
    weather.searchPlaces.mockResolvedValue({ ok: false, code: 'network' });
    const wrapper = render();
    await type(wrapper, 'Portland');
    await settle();
    const message = wrapper.get('[data-testid="home-town-message"]');
    expect(message.text()).toBe('weather.search.failed');
    expect(message.attributes('role')).toBe('status');
  });

  it('ignores an aborted search: no message, no list', async () => {
    weather.searchPlaces.mockResolvedValue({ ok: false, code: 'aborted' });
    const wrapper = render();
    await type(wrapper, 'Portland');
    await settle();
    expect(wrapper.get('[data-testid="home-town-message"]').text()).toBe('');
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it('picks a town with the keyboard and logs it without the query', async () => {
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    const input = wrapper.get('[data-testid="home-town-input"]');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[1]!.attributes('id')
    );
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(settings.setWeatherPlace).toHaveBeenCalledWith(PORTLAND_ME);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'weather',
        message: 'weather_place_set',
        context: { action: 'place-set', kind: 'name' },
      })
    );
    // Resolved: the place card replaces the field.
    expect(wrapper.get('[data-testid="home-town-place"]').text()).toContain('Portland, Maine');
  });

  it('keeps the last suggestions listed while the next query is searched', async () => {
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2);
    weather.searchPlaces.mockResolvedValue({ ok: true, places: [PORTLAND_ME] });
    await type(wrapper, 'Portla');
    // Mid-debounce: the spinner shows and the previous list stays open.
    expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="home-town-input"]').attributes('aria-expanded')).toBe('true');
    await settle();
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
  });

  it('Enter with nothing highlighted picks the first suggestion, never a stale one', async () => {
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    const input = wrapper.get('[data-testid="home-town-input"]');
    // A newer query is still searching: Enter must not commit the list on screen.
    await type(wrapper, 'Portla');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(settings.setWeatherPlace).not.toHaveBeenCalled();
    await settle();
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(settings.setWeatherPlace).toHaveBeenCalledWith(PORTLAND_OR);
  });

  it('Enter on a highlighted suggestion does nothing while a search runs; a click still picks', async () => {
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    const input = wrapper.get('[data-testid="home-town-input"]');
    await type(wrapper, 'Portla');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(settings.setWeatherPlace).not.toHaveBeenCalled();
    // A click on a visible suggestion is an explicit choice, searching or not.
    await wrapper.findAll('[role="option"]')[1]!.trigger('mousedown');
    await flushPromises();
    expect(settings.setWeatherPlace).toHaveBeenCalledWith(PORTLAND_ME);
  });

  it('names the combobox for assistive tech', () => {
    const input = render().get('[data-testid="home-town-input"]');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-label')).toBe('settings.weather.homeTown');
  });

  it('Escape closes the list without reaching the drawer', async () => {
    const wrapper = render();
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    await type(wrapper, 'Portl');
    await settle();
    await wrapper.get('[data-testid="home-town-input"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outer);
  });

  it('logs a ZIP pick as kind zip', async () => {
    weather.searchPlaces.mockResolvedValue({ ok: true, places: [PORTLAND_OR] });
    const wrapper = render();
    await type(wrapper, '97201');
    await settle();
    await wrapper.get('[role="option"]').trigger('mousedown');
    await flushPromises();
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'place-set', kind: 'zip' } })
    );
  });

  it('a rejected write keeps the typing state and logs nothing', async () => {
    settings.setWeatherPlace.mockRejectedValueOnce(new Error('persist failed'));
    const wrapper = render();
    await type(wrapper, 'Portl');
    await settle();
    await wrapper.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    expect(wrapper.find('[data-testid="home-town-place"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="home-town-input"]').element as HTMLInputElement).value).toBe(
      'Portl'
    );
    expect(wrapper.findAll('[role="option"]')).toHaveLength(2);
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it('resolved: shows the place card, the live preview and Change reopens the field', async () => {
    settings.weatherPlace = PORTLAND_OR;
    weather.atom = {
      state: 'reading',
      freshness: 'fresh',
      glyph: 'partly',
      temp: '66°',
      condition: 'Partly cloudy',
      high: '70°',
      low: '52°',
      highLow: 'H 70° L 52°',
      todayHighLow: 'Today H 70° L 52°',
      ageText: null,
      ageShort: null,
      soft: false,
      tonightLow: '50°',
      outlook: [],
      placeName: 'Portland',
    };
    const wrapper = render();
    expect(wrapper.get('[data-testid="home-town-place"]').text()).toContain('Portland, Oregon');
    const preview = wrapper.get('[data-testid="home-town-preview"]');
    expect(preview.text()).toContain('66°');
    expect(preview.get('[data-test="glyph"]').attributes('data-kind')).toBe('partly');
    await wrapper.get('[data-testid="home-town-change"]').trigger('click');
    expect(wrapper.find('[data-testid="home-town-input"]').exists()).toBe(true);
  });

  it('resolved with no reading to show: says weather is unavailable', () => {
    settings.weatherPlace = PORTLAND_OR;
    weather.atom = { state: 'unavailable', errorCode: 'network' };
    const wrapper = render();
    expect(wrapper.get('[data-testid="home-town-preview"]').text()).toBe('weather.unavailable');
  });

  it('a non-manager sees the place card without Change, and a disabled field when unset', () => {
    settings.weatherPlace = PORTLAND_OR;
    const withPlace = render({ disabled: true });
    expect(withPlace.find('[data-testid="home-town-place"]').exists()).toBe(true);
    expect(withPlace.find('[data-testid="home-town-change"]').exists()).toBe(false);
    withPlace.unmount();

    settings.weatherPlace = null;
    const unset = render({ disabled: true });
    expect(unset.get('[data-testid="home-town-input"]').attributes('disabled')).toBeDefined();
  });
});
