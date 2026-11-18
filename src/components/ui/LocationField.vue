<script setup lang="ts">
/**
 * The one location / address input (#150, ADR-049). Address suggestions from Google Maps while
 * typing, a picked place shown as a chip with the kept detail editable under it, and (in
 * `location-or-link` mode) a line saying what a pasted link was understood as.
 *
 * VALUE: `v-model:value` carries `{ text, place }` and the pair is never emitted apart. `text`
 * is the legacy string (still the source of truth); `place` is the optional sibling. The
 * parent writes both through `placePatch`, which drops a place that does not match the text.
 *
 * GATES. Flag off (`locationLinksEnabled()` false): today's `BaseInput` / `BaseTextarea` and
 * nothing else. Flag on but `available` false (switch off, offline, unconfigured, quiet): no
 * list and no request, but an existing picked place still shows as its chip and the
 * understood-as line still shows.
 *
 * MVO: this component talks to `usePlaceSearch` only (which talks to the store only). It
 * never logs: outcomes go through the composable's `note*` calls. Only the member's own
 * keystrokes reach `search.onInput`, so nothing else ever starts a lookup.
 *
 * A PICK IS APPLIED ONLY IF NOTHING CHANGED WHILE ITS ADDRESS WAS FETCHED (up to 10 s): every
 * member action that moves on (a keystroke, Keep what I typed, Escape, Remove, another pick)
 * bumps `pickToken`, and the pick checks its own token and the typed text when it lands.
 *
 * ARIA: single line = `BaseInput` with `role="combobox"` (the `HomeTownField` pattern).
 * Multi-line = `BaseTextarea`, which keeps its native textbox role: `aria-autocomplete`,
 * `aria-controls` and `aria-activedescendant` only (combobox is not a permitted role on a
 * textarea), and no lookup once the text holds a line break. ArrowUp / ArrowDown / Escape
 * belong to the list only while it is open; Enter picks only a highlighted row and is left
 * alone otherwise; Tab and blur close the list and keep the typed text.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useListboxNav } from '@/composables/useListboxNav';
import { usePlaceSearch } from '@/composables/usePlaceSearch';
import { useTranslation } from '@/composables/useTranslation';
import type { PlaceRef } from '@/types/models';
import type { PlaceFieldKind, PlaceSuggestion } from '@/types/placeSearch';
import { fillTemplate } from '@/utils/fillTemplate';
import { describeLocation, locationLinksEnabled } from '@/utils/location/locationLinks';
import { composePlaceText, detailOf, mapsHref, validPlace } from '@/utils/location/placeText';

defineOptions({ inheritAttrs: false });

export interface LocationValue {
  text: string;
  place?: PlaceRef;
}

const props = withDefaults(
  defineProps<{
    value: LocationValue;
    mode: 'location-or-link' | 'address';
    /** Which field this is, for telemetry only (a closed vocabulary). */
    fieldKind: PlaceFieldKind;
    multiline?: boolean;
    rows?: number;
    /** Today's in-input 📍 map anchor (travel forms). */
    mapPin?: boolean;
    /** The anchor's title (each form keeps its own key); defaults to `planner.openInMaps`. */
    mapPinTitle?: string;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    id?: string;
  }>(),
  {
    multiline: false,
    rows: 2,
    mapPin: false,
    mapPinTitle: undefined,
    label: undefined,
    placeholder: undefined,
    disabled: false,
    id: undefined,
  }
);

const emit = defineEmits<{ 'update:value': [value: LocationValue] }>();

const { t } = useTranslation();

/** Read once per mount: the flag is a build / per-browser setting, not reactive state. */
const enabled = locationLinksEnabled();

/** What is in the plain input (typing mode). */
const typed = ref(props.value.text ?? '');
/** The detail input's own text (picked mode), so a trailing space survives while typing. */
const detailDraft = ref('');
/** The text as typed when this field session made its pick, for Remove. */
const originalTyped = ref<string | null>(null);
/** The composed text that pick saved: Remove restores `originalTyped` only while unchanged. */
const pickedText = ref<string | null>(null);
/** Whether the typing input has focus: the list never opens under an unfocused field. */
const focused = ref(false);
const pickFailed = ref(false);
/** The stale-pick guard: bumped by every member action that supersedes a pick in flight. */
let pickToken = 0;
/** The token of the pick whose address is being fetched, while it is still the current one. */
let pickInFlight: number | null = null;
const supersedePick = () => {
  pickToken++;
};
const fieldWrap = ref<HTMLElement | null>(null);

/** The honoured place (flag on and `validPlace` holds), else undefined. */
const pickedPlace = computed<PlaceRef | undefined>(() =>
  enabled ? validPlace(props.value.text, props.value.place) : undefined
);

const search = usePlaceSearch({ fieldKind: props.fieldKind });

/** The place line split for display: "127 S Bridge Rd" over "Singapore 058285". */
const placeLines = computed(() => {
  const name = pickedPlace.value?.name ?? '';
  const at = name.indexOf(', ');
  return at > 0
    ? { main: name.slice(0, at), secondary: name.slice(at + 2) }
    : { main: name, secondary: '' };
});

// Keep the local drafts in step with the parent, without fighting the member's own typing.
watch(
  () => [props.value.text, props.value.place] as const,
  ([text]) => {
    const place = pickedPlace.value;
    if (place) {
      if (composePlaceText(place.name, detailDraft.value) !== (text ?? '').trim()) {
        detailDraft.value = detailOf(text, place);
      }
    } else if (typed.value !== (text ?? '')) {
      typed.value = text ?? '';
    }
  },
  { immediate: true }
);

onMounted(() => {
  // A stored place that no longer matches its string (an older build rewrote the start).
  if (enabled && props.value.place && !pickedPlace.value) search.noteStale();
});

// ── The list ─────────────────────────────────────────────────────────────────
const suggestions = computed<PlaceSuggestion[]>(() => search.suggestions.value);
/** Rows: every suggestion, then "Keep what I typed". No suggestions (or no focus) = no list. */
const rowCount = computed(() =>
  enabled && focused.value && !pickedPlace.value && suggestions.value.length > 0
    ? suggestions.value.length + 1
    : 0
);
// Only a keystroke undoes a dismissal (Escape, blur, Keep what I typed). A late answer never
// does, so it cannot reopen the list under a field the member has left.
const nav = useListboxNav(rowCount, () => typed.value);
const listOpen = computed(() => nav.open.value);
const keepIndex = computed(() => suggestions.value.length);

function emitValue(next: LocationValue): void {
  emit('update:value', next.place ? { text: next.text, place: next.place } : { text: next.text });
}

function onTyped(text: string): void {
  // An input event means the field has focus (a keystroke, a paste, a dictation).
  focused.value = true;
  typed.value = text;
  pickFailed.value = false;
  supersedePick();
  if (enabled && !pickedPlace.value) search.onInput(text);
  // Flag off: the place rides along untouched, exactly as an older build would leave it.
  emitValue({ text, place: enabled ? undefined : props.value.place });
}

function onDetail(detail: string): void {
  const place = pickedPlace.value;
  if (!place) return;
  detailDraft.value = detail;
  // The same place object, so a diff writes the string only.
  emitValue({ text: composePlaceText(place.name, detail), place: props.value.place });
}

async function choose(index: number): Promise<void> {
  if (props.disabled) return;
  if (index === keepIndex.value) {
    keepTyped();
    return;
  }
  const suggestion = suggestions.value[index];
  // A second tap on the same pick sends no second (paid) address fetch.
  if (!suggestion || pickInFlight === pickToken) return;
  supersedePick();
  const mine = pickToken;
  pickInFlight = mine;
  const typedAtPick = typed.value;
  const stillCurrent = () => mine === pickToken && typed.value === typedAtPick;
  const result = await search.pick(suggestion, typedAtPick, stillCurrent);
  if (pickInFlight === mine) pickInFlight = null;
  if (!result.ok) {
    if (result.code === 'aborted' || result.code === 'superseded') return;
    pickFailed.value = true;
    search.notePickFailedShown();
    return;
  }
  pickFailed.value = false;
  originalTyped.value = typedAtPick;
  pickedText.value = result.text;
  detailDraft.value = result.detail;
  nav.reset();
  emitValue({ text: result.text, place: result.place });
  // The typing input is gone; focus moves to the detail line rather than falling to <body>,
  // but only while it is still this field's (or was in the input that just unmounted). Focus
  // the member moved to another control meanwhile stays there.
  await nextTick();
  const active = document.activeElement;
  if (active && active !== document.body && !fieldWrap.value?.contains(active)) return;
  fieldWrap.value?.querySelector<HTMLElement>('[data-testid="location-detail"]')?.focus();
}

function keepTyped(): void {
  supersedePick();
  nav.dismissed.value = true;
  search.cancel();
  search.noteKeepTyped();
}

async function removePlace(): Promise<void> {
  // The original typing comes back only while the saved text is still what the pick made.
  // Once the detail was edited, the current composed text is restored, so no typed
  // character is lost either way.
  const current = props.value.text ?? '';
  const original =
    originalTyped.value !== null && pickedText.value === current.trim()
      ? originalTyped.value
      : null;
  const restored = original ?? current;
  supersedePick();
  search.noteRemoved(original !== null ? 'original' : 'composed');
  originalTyped.value = null;
  pickedText.value = null;
  typed.value = restored;
  emitValue({ text: restored });
  await nextTick();
  fieldWrap.value?.querySelector<HTMLElement>('input, textarea')?.focus();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') supersedePick();
  if (nav.onNavKey(e)) return;
  if (e.key !== 'Enter' || !listOpen.value) return;
  // Enter picks only a highlighted row; with nothing highlighted it is left alone (a newline
  // in a textarea, the form's own behaviour in an input).
  if (nav.active.value < 0) return;
  e.preventDefault();
  void choose(nav.active.value);
}

function onFocus(): void {
  focused.value = true;
}

function onBlur(): void {
  // Tab and blur close the list, keep the typed text and drop the lookup in flight (rows use
  // mousedown.prevent, so a click on one does not blur first).
  focused.value = false;
  nav.dismissed.value = true;
  search.cancel();
}

// ── Understood-as line (location-or-link mode) ───────────────────────────────
const understood = computed(() => {
  if (!enabled || props.mode !== 'location-or-link') return null;
  const view = describeLocation(props.value.text, props.value.place, { enabled: true });
  if (!view.links.length) return null;
  const call = view.links.find((l) => l.kind === 'call');
  const hasPlace = view.plain !== '';
  let text: string;
  if (hasPlace && call) {
    text = fillTemplate(t('location.understood.placeAndCall'), { service: call.service ?? '' });
  } else if (hasPlace) text = t('location.understood.placeAndLink');
  else if (call)
    text = fillTemplate(t('location.understood.call'), { service: call.service ?? '' });
  else if (view.links.some((l) => l.kind === 'web')) text = t('location.understood.link');
  else text = t('location.understood.map');
  return { text, icon: call ? 'video' : 'link' };
});

const pinHref = computed(() =>
  enabled ? mapsHref(props.value.text, props.value.place) : mapsHref(props.value.text)
);
const pinTitle = computed(() => props.mapPinTitle ?? t('planner.openInMaps'));
const pinClass = computed(() =>
  props.multiline
    ? 'absolute top-2 right-2 text-sm opacity-40 transition-opacity hover:opacity-80'
    : 'absolute top-1/2 right-2 -translate-y-1/2 text-sm opacity-40 transition-opacity hover:opacity-80'
);

/** The legacy control's own props (a textarea also takes `rows`). Undefined ones are dropped
 *  so the control's markup matches the inline `BaseInput` it replaces. */
const legacyProps = computed(() => {
  const all: Record<string, unknown> = {
    label: props.label,
    placeholder: props.placeholder,
    disabled: props.disabled || undefined,
    id: props.id,
    ...(props.multiline ? { rows: props.rows } : {}),
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
});

const statusMessage = computed(() => (pickFailed.value ? t('location.pickFailed') : ''));
</script>

<template>
  <!-- Flag off: today's control, today's markup, nothing else. -->
  <template v-if="!enabled">
    <div v-if="mapPin" class="relative">
      <component
        :is="multiline ? BaseTextarea : BaseInput"
        :model-value="value.text"
        v-bind="{ ...legacyProps, ...$attrs }"
        @update:model-value="onTyped(String($event))"
      />
      <a
        v-if="value.text"
        :href="pinHref"
        target="_blank"
        rel="noopener noreferrer"
        :class="pinClass"
        :title="pinTitle"
        @click.stop
      >
        📍
      </a>
    </div>
    <component
      :is="multiline ? BaseTextarea : BaseInput"
      v-else
      :model-value="value.text"
      v-bind="{ ...legacyProps, ...$attrs }"
      @update:model-value="onTyped(String($event))"
    />
  </template>

  <div v-else ref="fieldWrap" data-testid="location-field">
    <!-- Picked: the place chip, the detail input under it, and the helper line. -->
    <template v-if="pickedPlace">
      <div
        class="dark:border-line-strong bg-sky-silk-50 dark:bg-surface-overlay flex min-h-11 items-center gap-2 rounded-t-xl border border-gray-300 px-3 py-2"
        data-testid="location-place"
      >
        <BeanieIcon
          name="map-pin"
          size="sm"
          class="text-primary-500 dark:text-accent-lift shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="font-outfit text-secondary-500 dark:text-ink truncate text-sm font-semibold">
            {{ placeLines.main }}
          </p>
          <p
            v-if="placeLines.secondary"
            class="text-secondary-400 dark:text-ink-soft truncate text-xs"
          >
            {{ placeLines.secondary }}
          </p>
        </div>
        <a
          v-if="mapPin"
          :href="pinHref"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 text-sm opacity-40 transition-opacity hover:opacity-80"
          :title="pinTitle"
          @click.stop
        >
          📍
        </a>
        <button
          v-if="!disabled"
          type="button"
          class="text-secondary-500 dark:text-ink-soft dark:bg-surface-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white"
          :aria-label="t('location.removePlace')"
          :title="t('location.removePlace')"
          data-testid="location-remove-place"
          @click="removePlace"
        >
          <BeanieIcon name="close" size="xs" />
        </button>
      </div>
      <BaseInput
        :model-value="detailDraft"
        :aria-label="t('location.detailLabel')"
        :placeholder="t('location.detailLabel')"
        :disabled="disabled"
        class="rounded-t-none border-t-0"
        data-testid="location-detail"
        @update:model-value="onDetail(String($event))"
      />
      <p class="text-secondary-400 dark:text-ink-faint mt-1.5 text-xs">
        {{ t(detailDraft.trim() ? 'location.detailHint' : 'location.detailHintEmpty') }}
      </p>
    </template>

    <!-- Typing: the plain input with the suggestion list under it. -->
    <template v-else>
      <div class="relative">
        <BaseTextarea
          v-if="multiline"
          :id="id"
          :model-value="typed"
          :rows="rows"
          :label="label"
          :placeholder="placeholder"
          :disabled="disabled"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-controls="nav.listboxId"
          :aria-activedescendant="nav.activeDescendant.value"
          v-bind="$attrs"
          data-testid="location-input"
          @update:model-value="onTyped(String($event))"
          @keydown="onKeydown"
          @focus="onFocus"
          @blur="onBlur"
        />
        <BaseInput
          v-else
          :id="id"
          :model-value="typed"
          :label="label"
          :placeholder="placeholder"
          :disabled="disabled"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="listOpen"
          :aria-controls="nav.listboxId"
          :aria-activedescendant="nav.activeDescendant.value"
          v-bind="$attrs"
          data-testid="location-input"
          @update:model-value="onTyped(String($event))"
          @keydown="onKeydown"
          @focus="onFocus"
          @blur="onBlur"
        >
          <template v-if="understood" #leading>
            <BeanieIcon
              :name="understood.icon"
              size="sm"
              class="text-primary-500 dark:text-accent-lift"
            />
          </template>
        </BaseInput>
        <a
          v-if="mapPin && typed"
          :href="pinHref"
          target="_blank"
          rel="noopener noreferrer"
          :class="pinClass"
          :title="pinTitle"
          @click.stop
        >
          📍
        </a>
      </div>

      <div
        v-if="listOpen"
        class="dark:border-line dark:bg-surface-overlay mt-1.5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg"
        data-testid="location-suggestions"
      >
        <ul :id="nav.listboxId" role="listbox" :aria-label="t('location.suggestions')" class="p-1">
          <li
            v-for="(s, i) in suggestions"
            :id="nav.optionId(i)"
            :key="s.placeId"
            role="option"
            :aria-selected="i === nav.active.value"
            class="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2"
            :class="
              i === nav.active.value
                ? 'dark:bg-surface-hover bg-[var(--tint-silk-20)]'
                : 'dark:hover:bg-surface-hover hover:bg-[var(--tint-slate-5)]'
            "
            @mousedown.prevent="choose(i)"
          >
            <BeanieIcon
              name="map-pin"
              size="sm"
              class="text-primary-500 dark:text-accent-lift mt-0.5 shrink-0"
            />
            <span class="min-w-0">
              <span
                class="font-outfit text-secondary-500 dark:text-ink block truncate text-sm font-semibold"
                >{{ s.main }}</span
              >
              <span
                v-if="s.secondary"
                class="text-secondary-400 dark:text-ink-faint block truncate text-xs"
                >{{ s.secondary }}</span
              >
            </span>
          </li>
          <li
            :id="nav.optionId(keepIndex)"
            role="option"
            :aria-selected="keepIndex === nav.active.value"
            class="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2"
            :class="
              keepIndex === nav.active.value
                ? 'dark:bg-surface-hover bg-[var(--tint-silk-20)]'
                : 'dark:hover:bg-surface-hover hover:bg-[var(--tint-slate-5)]'
            "
            data-testid="location-keep-typed"
            @mousedown.prevent="choose(keepIndex)"
          >
            <BeanieIcon
              name="type-text"
              size="sm"
              class="text-secondary-400 dark:text-ink-soft mt-0.5 shrink-0"
            />
            <span class="min-w-0">
              <span
                class="font-outfit text-secondary-500 dark:text-ink-soft block text-sm font-semibold"
                >{{ t('location.keepTyped') }}</span
              >
              <span class="text-secondary-400 dark:text-ink-faint block text-xs">{{
                t('location.keepTyped.hint')
              }}</span>
            </span>
          </li>
        </ul>
        <!-- Google's attribution: the text "Google Maps" inside the suggestion container, not
             localized (Places policies). -->
        <p
          class="text-secondary-400 dark:text-ink-faint px-3 pb-1.5 text-right text-xs"
          translate="no"
          data-testid="location-attribution"
        >
          Google Maps
        </p>
      </div>
    </template>

    <p
      v-if="understood"
      class="text-secondary-400 dark:text-ink-faint mt-1.5 text-xs"
      data-testid="location-understood"
    >
      {{ understood.text }}
    </p>

    <!-- Rendered unconditionally with only its text toggling: a live region inserted together
         with its content is not announced. Heritage Orange, never red: guidance, not a hard
         validation error. -->
    <p
      class="text-primary-700 dark:text-accent-lift mt-1.5 text-xs font-semibold empty:mt-0"
      role="status"
      aria-live="polite"
      data-testid="location-message"
    >
      {{ statusMessage }}
    </p>
  </div>
</template>
