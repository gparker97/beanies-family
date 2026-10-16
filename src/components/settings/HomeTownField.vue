<script setup lang="ts">
/**
 * The family's home town for the weather (#134, ADR-043): type a city or a ZIP/postcode, pick
 * one of the suggestions, and the place is stored in the family file.
 *
 * A live text field whose options come from a request, so it is not `BaseCombobox` (that
 * filters a static list behind a trigger button). The keyboard half of the APG combobox is
 * `useListboxNav`; this component owns the query, the debounce and the request.
 *
 * MVO: it reads `weatherStore.atom` (the preview line is the same atom every surface draws, so
 * there is no second fetch path) and calls `weatherStore.searchPlaces`, which returns every
 * outcome as a value and never throws, so the states render from the result with no
 * try/catch here. The write goes through `settingsStore.setWeatherPlace`, which toasts a
 * failed write and re-throws, so the field stays in the typing state.
 *
 * The device's location API is never called: the only location is the town a pod manager
 * types here.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import WeatherGlyph from '@/components/weather/WeatherGlyph.vue';
import { useListboxNav } from '@/composables/useListboxNav';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWeatherStore } from '@/stores/weatherStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { splitAroundAccent } from '@/utils/splitAroundAccent';
import type { WeatherPlace } from '@/types/models';

const props = withDefaults(
  defineProps<{
    /** Read-only for anyone who is not a pod manager: the place card shows without "Change". */
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { disabled: false, placeholder: undefined }
);

/** Long enough to skip the keystrokes in a word, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;
/** Mirrors the service's floor (`SEARCH_MIN_CHARS`): a 1-letter query is never sent. */
const MIN_QUERY = 2;

type SearchStatus = 'idle' | 'searching' | 'results' | 'not-found' | 'failed';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const weatherStore = useWeatherStore();

const query = ref('');
const places = ref<WeatherPlace[]>([]);
const status = ref<SearchStatus>('idle');
/** The query the shown results (or the not-found line) answer. */
const answeredQuery = ref('');
/** True while a stored place is being replaced ("Change"). */
const editing = ref(false);
const fieldWrap = ref<HTMLElement | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;

const storedPlace = computed(() => settingsStore.weatherPlace);
const showPlaceCard = computed(() => !!storedPlace.value && !editing.value);
const atom = computed(() => weatherStore.atom);

const visibleCount = computed(() => (status.value === 'results' ? places.value.length : 0));
const nav = useListboxNav(visibleCount, () => [query.value, places.value]);

const message = computed(() => {
  if (status.value === 'not-found')
    return fillTemplate(t('settings.weather.notFound'), { query: answeredQuery.value });
  if (status.value === 'failed') return t('weather.search.failed');
  return '';
});

function titleOf(place: WeatherPlace): string {
  return place.admin1 ? `${place.name}, ${place.admin1}` : place.name;
}

/** Each suggestion with the typed text bolded; a ZIP (not in the name) degrades to plain. */
const rows = computed(() =>
  places.value.map((place) => ({
    place,
    ...splitAroundAccent(place.name, answeredQuery.value.trim()),
    rest: place.admin1 ? `, ${place.admin1}` : '',
  }))
);

function cancelPending(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  controller?.abort();
  controller = null;
}

async function runSearch(q: string): Promise<void> {
  const mine = new AbortController();
  controller = mine;
  const result = await weatherStore.searchPlaces(q, mine.signal);
  // A newer keystroke (or unmount) superseded this request: its answer is not wanted.
  if (controller !== mine) return;
  controller = null;
  if (!result.ok) {
    if (result.code === 'aborted') return;
    // The store already logged it and printed the `[weather]` devHint.
    answeredQuery.value = q;
    places.value = [];
    status.value = 'failed';
    return;
  }
  answeredQuery.value = q;
  places.value = result.places;
  status.value = result.places.length ? 'results' : 'not-found';
}

watch(query, (raw) => {
  cancelPending();
  const q = raw.trim();
  if (q.length < MIN_QUERY) {
    places.value = [];
    status.value = 'idle';
    return;
  }
  status.value = 'searching';
  timer = setTimeout(() => {
    timer = null;
    void runSearch(q);
  }, SEARCH_DEBOUNCE_MS);
});

onBeforeUnmount(cancelPending);

async function pick(place: WeatherPlace): Promise<void> {
  if (props.disabled) return;
  const kind = /^\d+$/.test(query.value.trim()) ? 'zip' : 'name';
  try {
    await settingsStore.setWeatherPlace(place);
  } catch {
    // Already toasted and reported by `persistAiSetting`; the field stays as typed.
    return;
  }
  logEvent({
    level: 'info',
    surface: 'weather',
    message: 'weather_place_set',
    // Never the query or the place: only whether it was found by ZIP or by name.
    context: { action: 'place-set', kind },
  });
  editing.value = false;
  query.value = '';
  places.value = [];
  status.value = 'idle';
  nav.reset();
}

function onKeydown(e: KeyboardEvent): void {
  if (nav.onNavKey(e)) return;
  if (e.key !== 'Enter') return;
  // Enter never submits the drawer around the field; it picks the highlighted town.
  e.preventDefault();
  const chosen = nav.open.value && nav.active.value >= 0 ? places.value[nav.active.value] : null;
  if (chosen) void pick(chosen);
}

async function startChange(): Promise<void> {
  editing.value = true;
  await nextTick();
  fieldWrap.value?.querySelector('input')?.focus();
}

function onBlur(): void {
  // Leaving "Change" without typing keeps the stored town.
  if (editing.value && storedPlace.value && !query.value.trim()) editing.value = false;
}
</script>

<template>
  <div>
    <template v-if="showPlaceCard && storedPlace">
      <div
        class="bg-secondary-50 dark:bg-surface-overlay flex items-center gap-3 rounded-2xl px-3.5 py-3"
        data-testid="home-town-place"
      >
        <BeanieIcon name="map-pin" class="text-secondary-400 dark:text-ink-soft shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="font-outfit dark:text-ink text-secondary-500 truncate text-sm font-semibold">
            {{ titleOf(storedPlace) }}
          </p>
          <p class="dark:text-ink-soft text-secondary-400 truncate text-xs">
            {{ storedPlace.country }}
          </p>
        </div>
        <button
          v-if="!disabled"
          type="button"
          class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 text-sm font-semibold"
          data-testid="home-town-change"
          @click="startChange"
        >
          {{ t('action.change') }}
        </button>
      </div>
      <div
        v-if="atom?.state === 'reading'"
        class="dark:text-ink-soft text-secondary-400 mt-2.5 flex items-center gap-2 text-sm"
        data-testid="home-town-preview"
      >
        <WeatherGlyph :kind="atom.glyph" :size="22" />
        <span class="font-outfit dark:text-ink text-secondary-500 font-bold">{{
          atom.temp ?? fillTemplate(t('weather.todayHighLow'), { high: atom.high, low: atom.low })
        }}</span>
        <span>{{
          fillTemplate(t('settings.weather.preview'), { condition: atom.condition })
        }}</span>
      </div>
      <p
        v-else-if="atom?.state === 'unavailable'"
        class="dark:text-ink-soft text-secondary-400 mt-2.5 text-sm"
        data-testid="home-town-preview"
      >
        {{ t('weather.unavailable') }}
      </p>
    </template>

    <template v-else>
      <div ref="fieldWrap">
        <BaseInput
          v-model="query"
          :placeholder="placeholder"
          :disabled="disabled"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="nav.open.value"
          :aria-controls="nav.listboxId"
          :aria-activedescendant="nav.activeDescendant.value"
          data-testid="home-town-input"
          @keydown="onKeydown"
          @blur="onBlur"
        >
          <template #leading>
            <BeanieIcon name="map-pin" size="sm" />
          </template>
        </BaseInput>
      </div>

      <div v-if="status === 'searching'" class="mt-2 flex justify-start px-1">
        <BeanieSpinner size="sm" label :halo="false" />
      </div>

      <ul
        v-if="nav.open.value"
        :id="nav.listboxId"
        role="listbox"
        class="dark:border-line-strong dark:bg-surface-overlay mt-1.5 rounded-2xl border border-gray-200 bg-white p-1"
        data-testid="home-town-listbox"
      >
        <li
          v-for="(row, i) in rows"
          :id="nav.optionId(i)"
          :key="row.place.id"
          role="option"
          :aria-selected="i === nav.active.value"
          class="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2"
          :class="
            i === nav.active.value
              ? 'dark:bg-surface-hover bg-[var(--tint-silk-20)]'
              : 'dark:hover:bg-surface-hover hover:bg-[var(--tint-slate-5)]'
          "
          @mousedown.prevent="pick(row.place)"
        >
          <BeanieIcon
            name="map-pin"
            size="sm"
            class="text-secondary-400 dark:text-ink-soft shrink-0"
          />
          <span class="min-w-0">
            <span class="dark:text-ink text-secondary-500 block truncate text-sm"
              >{{ row.lead }}<b class="font-semibold">{{ row.accent }}</b
              >{{ row.trail }}{{ row.rest }}</span
            >
            <span class="dark:text-ink-faint text-secondary-400 block truncate text-xs">{{
              row.place.country
            }}</span>
          </span>
        </li>
      </ul>

      <!-- Rendered unconditionally with only its text toggling: a live region inserted
           together with its content is not announced. Heritage Orange, never red: this is
           guidance, not a hard validation error. -->
      <p
        class="text-primary-600 dark:text-accent-lift mt-1.5 text-xs font-semibold empty:mt-0"
        role="status"
        aria-live="polite"
        data-testid="home-town-message"
      >
        {{ message }}
      </p>
    </template>
  </div>
</template>
