/**
 * The month grid's per-device preferences (#141), driven by ONE spec table.
 *
 * Five closed-set choices, each a `usePersistedChoice` ref (device-local, never in the
 * pod; one member's density must not re-lay another member's screen):
 *
 * | name         | storage key                  | allowed                  | default   |
 * |--------------|------------------------------|--------------------------|-----------|
 * | density      | `MONTH_GRID_DENSITY`         | compact, comfortable     | compact   |
 * | times        | `MONTH_GRID_TIMES`           | shown, hidden            | shown     |
 * | soloFaces    | `MONTH_GRID_SOLO_FACES`      | shown, hidden            | shown     |
 * | phoneMode    | `PHONE_MONTH_MODE`           | grid, list               | grid      |
 * | phoneDensity | `PHONE_MONTH_DENSITY`        | faces, bars, titles      | titles    |
 *
 * One instance per mounted page: `FamilyPlannerPage` owns one and passes `values` down (the
 * command bar and the grid stay presentational), and the Settings page owns another for its
 * phone-density select. `usePersistedChoice` refs do not share state between instances, but
 * the planner and Settings are never mounted at the same time (separate routes under one
 * router-view, no KeepAlive), so each reads the stored value fresh when it mounts. If a
 * future surface needs two instances live at once, make this a module singleton (the
 * `useStaleTabRefresh` pattern) rather than letting them disagree.
 *
 * Every change goes through the one setter, `setPref`, with the typed `MonthPrefChange`
 * (a discriminated union, so a mismatched name and value is a compile error wherever it is
 * emitted). It still validates at runtime against the spec: an invalid value is ignored
 * and logged as `invalid_pref_value`; a valid one is assigned and logged as
 * `pref_changed`, so adoption of each density and mode is measurable.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { DESKTOP_DENSITIES, PHONE_DENSITIES } from '@/constants/calendarCaps';
import { logEvent } from '@/services/telemetry/logEvent';

const SHOWN_HIDDEN = ['shown', 'hidden'] as const;

export const MONTH_GRID_PREF_SPECS = {
  density: {
    key: STORAGE_KEYS.MONTH_GRID_DENSITY,
    allowed: DESKTOP_DENSITIES,
    fallback: 'compact',
  },
  times: { key: STORAGE_KEYS.MONTH_GRID_TIMES, allowed: SHOWN_HIDDEN, fallback: 'shown' },
  soloFaces: { key: STORAGE_KEYS.MONTH_GRID_SOLO_FACES, allowed: SHOWN_HIDDEN, fallback: 'shown' },
  phoneMode: {
    key: STORAGE_KEYS.PHONE_MONTH_MODE,
    allowed: ['grid', 'list'] as const,
    fallback: 'grid',
  },
  phoneDensity: {
    key: STORAGE_KEYS.PHONE_MONTH_DENSITY,
    allowed: PHONE_DENSITIES,
    fallback: 'titles',
  },
} as const;

type Specs = typeof MONTH_GRID_PREF_SPECS;
export type MonthPrefName = keyof Specs;
type SpecValue<K extends MonthPrefName> = Specs[K]['allowed'][number];

/** One read-only snapshot of every preference. */
export type MonthPrefValues = { [K in MonthPrefName]: SpecValue<K> };

/** The one typed change shape, emitted by the command bar and the grid. */
export type MonthPrefChange = {
  [K in MonthPrefName]: { name: K; value: SpecValue<K> };
}[MonthPrefName];

/** Where a change came from (the `stage` of `pref_changed`). */
export type MonthPrefVia = 'menu' | 'pinch' | 'm_pill' | 'settings';

/** The two-value preferences, which a toggle flips. */
export type MonthPrefToggleName = 'times' | 'soloFaces' | 'phoneMode';

/** The other value of a two-value preference. Pure, so a presentational caller holding only
 *  the snapshot can flip it with no inline ternary on the literals. */
export function flippedPrefValue<K extends MonthPrefToggleName>(
  name: K,
  values: MonthPrefValues
): SpecValue<K> {
  const allowed = MONTH_GRID_PREF_SPECS[name].allowed as readonly SpecValue<K>[];
  return (allowed[0] === values[name] ? allowed[1] : allowed[0]) as SpecValue<K>;
}

const SURFACE = 'calendar-month-grid';

export function useMonthGridPrefs(): {
  values: ComputedRef<Readonly<MonthPrefValues>>;
  setPref: (change: MonthPrefChange, via: MonthPrefVia) => void;
} {
  const refs = {
    density: usePersistedChoice(
      MONTH_GRID_PREF_SPECS.density.key,
      MONTH_GRID_PREF_SPECS.density.allowed,
      MONTH_GRID_PREF_SPECS.density.fallback
    ),
    times: usePersistedChoice(
      MONTH_GRID_PREF_SPECS.times.key,
      MONTH_GRID_PREF_SPECS.times.allowed,
      MONTH_GRID_PREF_SPECS.times.fallback
    ),
    soloFaces: usePersistedChoice(
      MONTH_GRID_PREF_SPECS.soloFaces.key,
      MONTH_GRID_PREF_SPECS.soloFaces.allowed,
      MONTH_GRID_PREF_SPECS.soloFaces.fallback
    ),
    phoneMode: usePersistedChoice(
      MONTH_GRID_PREF_SPECS.phoneMode.key,
      MONTH_GRID_PREF_SPECS.phoneMode.allowed,
      MONTH_GRID_PREF_SPECS.phoneMode.fallback
    ),
    phoneDensity: usePersistedChoice(
      MONTH_GRID_PREF_SPECS.phoneDensity.key,
      MONTH_GRID_PREF_SPECS.phoneDensity.allowed,
      MONTH_GRID_PREF_SPECS.phoneDensity.fallback
    ),
  } satisfies { [K in MonthPrefName]: Ref<SpecValue<K>> };

  const values = computed<Readonly<MonthPrefValues>>(() => ({
    density: refs.density.value,
    times: refs.times.value,
    soloFaces: refs.soloFaces.value,
    phoneMode: refs.phoneMode.value,
    phoneDensity: refs.phoneDensity.value,
  }));

  function setPref(change: MonthPrefChange, via: MonthPrefVia): void {
    const spec = MONTH_GRID_PREF_SPECS[change.name];
    if (!(spec.allowed as readonly string[]).includes(change.value)) {
      // A runtime-only backstop: `MonthPrefChange` makes this unreachable from typed code.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'invalid_pref_value',
        context: { action: 'invalid_pref_value', kind: change.name, stage: via },
      });
      return;
    }
    (refs[change.name] as Ref<string>).value = change.value;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'pref_changed',
      context: { action: 'pref_changed', kind: change.name, detail: change.value, stage: via },
    });
  }

  return { values, setPref };
}
