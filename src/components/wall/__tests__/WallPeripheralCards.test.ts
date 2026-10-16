/**
 * The weather glance in the peripheral cards (#134): it leads the rail, the band and the
 * strip, the strip's cells share one class string, and weather is absent whenever the family
 * switch, this wall's Off, or a missing provider says so.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import WallPeripheralCards from '../WallPeripheralCards.vue';
import { WALL_WEATHER } from '../wallWeatherKey';
import type { WallWeatherSize } from '../wallLayout';
import type { WeatherAtom } from '@/types/weather';
import type { FamilyList } from '@/types/models';
import type { WallJob, WallPeripheralData } from '@/types/wall';
import { ATOMS } from './wallWeatherFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ sortedHumans: [], members: [] }),
}));

let atom: WeatherAtom | null = null;
vi.mock('@/stores/weatherStore', () => ({
  useWeatherStore: () => ({
    get atom() {
      return atom;
    },
  }),
}));

const tonight = ref<unknown>(null);
const trip = ref<unknown>(null);
vi.mock('@/composables/useWallPeripherals', () => ({
  useWallPeripherals: () => ({ tonight, trip, timelineItems: ref([]) }),
}));

const todo: WallJob = {
  key: 'todo:t1',
  title: 'Sign the form',
  done: false,
  ownerId: '__unassigned__',
  source: 'todo',
  todoId: 't1',
  bucket: 'today',
} as WallJob;
const list = { id: 'l1', title: 'Morning jobs', emoji: '🧺', ownerId: 'x' } as FamilyList;

function peripherals(full: boolean): WallPeripheralData {
  return {
    todosFor: () => [],
    unassignedTodos: full ? [todo] : [],
    allTodos: full ? [todo] : [],
    listsFor: () => [],
    orphanLists: full ? [{ list, jobs: [{ ...todo, key: 'list:l1:i1', source: 'list' }] }] : [],
    visibleMemberIds: null,
  };
}

function mountCards(
  variant: 'band' | 'rail' | 'strip',
  size: WallWeatherSize | null,
  opts: { full?: boolean; portrait?: boolean } = {}
) {
  return mount(WallPeripheralCards, {
    props: {
      variant,
      portrait: opts.portrait,
      mealsYmd: '2026-10-16',
      peripherals: peripherals(opts.full ?? true),
    },
    global: {
      provide: size === null ? {} : { [WALL_WEATHER as symbol]: computed(() => size) },
      stubs: { BeanieIcon: { template: '<i class="pin" />' }, WallOwnerFaces: true },
    },
  });
}

beforeEach(() => {
  atom = ATOMS.fresh;
  tonight.value = { emoji: '🍕', name: 'Pizza night', slotKey: 'meal.dinner', cook: null };
  trip.value = {
    name: 'Tokyo',
    travellers: [],
    startDate: '2026-10-20',
    endDate: '2026-10-25',
    percent: 0,
  };
});

describe('WallPeripheralCards weather', () => {
  it.each([
    ['rail', false],
    ['band', false],
    ['band', true],
  ] as const)('leads the %s (portrait %s)', (variant, portrait) => {
    const wrapper = mountCards(variant, 'full', { portrait });
    const cards = wrapper.findAll('.wall-card');
    expect(cards.length).toBe(5);
    expect(cards[0]!.classes()).toContain('wall-weather-card');
    expect(cards[0]!.element.tagName).toBe('DIV');
    expect(cards[0]!.attributes('data-layout')).toBe('full');
  });

  it('gives the weather the first band column', () => {
    const grid = mountCards('band', 'now').get('.grid');
    expect(grid.attributes('style')).toContain(
      'grid-template-columns: 1.1fr 1.55fr 1fr 0.95fr 1.2fr'
    );
  });

  it('hands the provided size to the card as its layout', () => {
    for (const size of ['line', 'now', 'full'] as const) {
      expect(mountCards('rail', size).get('.wall-weather-card').attributes('data-layout')).toBe(
        size
      );
    }
  });

  it('leads the strip with a non-interactive cell, and every cell shares STRIP_CELL', () => {
    const strip = mountCards('strip', 'line').get('.flex.shrink-0');
    const cells = strip.element.children;
    expect(cells.length).toBe(5);
    const first = cells[0]!;
    expect(first.tagName).toBe('SPAN');
    expect(first.classList.contains('wall-weather-strip')).toBe(true);
    expect(first.textContent).toContain('66°');
    expect(first.textContent).toContain('Partly cloudy');
    const shared = [...cells].map((c) =>
      [...c.classList].filter((cls) => cls !== 'wall-weather-strip' && cls !== 'min-w-0').join(' ')
    );
    expect(new Set(shared).size).toBe(1);
    expect(shared[0]).toContain('last:border-r-0');
  });

  it('strip cell: the clipped age when stale, the short nudge, the short unavailable', () => {
    atom = ATOMS.aged;
    expect(mountCards('strip', 'now').get('.wall-weather-strip').text()).toContain('3 hours ago');
    atom = ATOMS.nudge;
    expect(mountCards('strip', 'now').get('.wall-weather-strip').text()).toContain(
      'weather.nudgeStrip'
    );
    atom = ATOMS.unavailable;
    expect(mountCards('strip', 'now').get('.wall-weather-strip').text()).toContain(
      'weather.unavailableShort'
    );
  });

  it('keeps a strip with nothing but weather in it', () => {
    tonight.value = null;
    trip.value = null;
    const wrapper = mountCards('strip', 'line', { full: false });
    expect(wrapper.find('.wall-weather-strip').exists()).toBe(true);
  });

  describe.each(['rail', 'band', 'strip'] as const)('absent on the %s', (variant) => {
    it('when the family switch is off (the atom is null)', () => {
      atom = null;
      const wrapper = mountCards(variant, 'full');
      expect(wrapper.find('.wall-weather-card').exists()).toBe(false);
      expect(wrapper.find('.wall-weather-strip').exists()).toBe(false);
    });

    it('when this wall is Off', () => {
      const wrapper = mountCards(variant, 'off');
      expect(wrapper.find('.wall-weather-card').exists()).toBe(false);
      expect(wrapper.find('.wall-weather-strip').exists()).toBe(false);
    });

    it('when no provider exists', () => {
      const wrapper = mountCards(variant, null);
      expect(wrapper.find('.wall-weather-card').exists()).toBe(false);
      expect(wrapper.find('.wall-weather-strip').exists()).toBe(false);
    });
  });
});
