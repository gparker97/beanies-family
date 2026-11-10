<script setup lang="ts">
/**
 * One booking on the trip timeline.
 *
 * WHY THIS EXISTS: the page rendered this card TWICE — a full version for dated bookings and
 * a 42-line subset for the "still deciding" (undated) group. The subset silently lacked the
 * attachments strip, inline date/time editing, copyable booking references, expandable notes
 * and outbound links. So a flight with no date yet could not have its confirmation number
 * copied, its documents seen or its fields edited — with nothing to indicate the difference.
 * The two copies had already drifted apart; a third edit would have drifted further.
 *
 * Both call sites now render this. The date-specific parts are `v-if`-guarded on
 * `item.timing`, which undated items omit by construction, so sharing costs nothing.
 *
 * Presentational: every mutation leaves as an emit. The page keeps permission checks,
 * persistence and toasts.
 *
 * Live flight checks (#143): a flight card carries its `FlightCheckChip` in the header (none
 * once the flight is over, `hasFlightChip`), passes the airline-replaced values
 * (`verification.was`) to the band, and shows the `FlightChangeNotice` under it for changed /
 * conflict / cancelled. `verification` and `nowMs`
 * are props from the page (`flightStatusStore`), never read here. Trains, ferries, cruises and
 * buses get a quiet foot line instead of a chip, so a card that cannot be checked never looks
 * unverified.
 */
import { computed } from 'vue';
import VacationSegmentCard from '@/components/vacation/VacationSegmentCard.vue';
import SegmentWhenBand from '@/components/travel/SegmentWhenBand.vue';
import FlightCheckChip from '@/components/travel/FlightCheckChip.vue';
import FlightChangeNotice from '@/components/travel/FlightChangeNotice.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import PhotoThumbnail from '@/components/media/PhotoThumbnail.vue';
import ExpandableText from '@/components/ui/ExpandableText.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BeanieTimePicker from '@/components/ui/BeanieTimePicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { safeExternalHref } from '@/utils/url';
import { hasFlightChip } from '@/utils/flightStatus/copy';
import type { TimelineItem } from '@/composables/useVacationTimeline';
import type { FlightVerification } from '@/types/flightStatus';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  item: TimelineItem;
  collapsed: boolean;
  readOnly: boolean;
  /** The hint for THIS item, already resolved by the page — not the whole map. */
  hint?: { message?: string; nightFlight?: 'early-morning' | 'late-night' } | undefined;
  /** This segment's live flight check (`flightStatusStore.verificationFor(item.id)`). */
  verification?: FlightVerification;
  /** The clock the chip and notice measure "checked N min ago" against. */
  nowMs?: number;
}>();

const emit = defineEmits<{
  'inline-save': [item: TimelineItem, field: string, value: string];
  edit: [item: TimelineItem];
  delete: [item: TimelineItem];
  'update:collapsed': [id: string, collapsed: boolean];
  'open-attachment': [segmentId: string, photoIds: string[], photoId: string];
  /** "Put it back": restore the values from before the airline's change. */
  revert: [item: TimelineItem];
  /** "Update with airline data": write the airline's schedule over a Conflict. */
  'take-airline': [item: TimelineItem];
  /** "Got it": fold the notice block away on this device. */
  'dismiss-notice': [item: TimelineItem];
  /** The chip on a dismissed notice: show the block again. */
  'show-notice': [item: TimelineItem];
}>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();

const travellerNamesLabel = computed(() =>
  props.item.travellers.map((id) => getMemberName(id)).join(', ')
);

/** A flight with a verification: the chip and (when something happened) the notice show. */
const flightCheck = computed(() =>
  props.item.flight && props.verification ? props.verification : undefined
);
const clock = computed(() => props.nowMs ?? Date.now());

/** A flight that is over carries no chip (`hasFlightChip`); its band and notes stay. */
const showChip = computed(() => !!flightCheck.value && hasFlightChip(flightCheck.value));

const showNotice = computed(() => {
  const s = flightCheck.value?.state;
  return (
    (s === 'changed' || s === 'conflict' || s === 'cancelled') && !flightCheck.value?.dismissed
  );
});
/** The block was folded away with "Got it": the chip reopens it. */
const chipReveals = computed(() => flightCheck.value?.dismissed === true);

/** The foot line for the kinds that are never checked live (and say so plainly). */
const NOT_LIVE_FOOT: Record<string, UIStringKey> = {
  'travel:train': 'travel.live.notLiveFoot.train',
  'travel:ferry': 'travel.live.notLiveFoot.ferry',
  'travel:cruise': 'travel.live.notLiveFoot.cruise',
  'transportation:bus': 'travel.live.notLiveFoot.bus',
};
const notLiveFootKey = computed(
  () => NOT_LIVE_FOOT[`${props.item.kind}:${props.item.segmentType}`]
);

/** Copy a booking reference. Clipboard failures are non-fatal and need no toast. */
async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Denied permission or an insecure context — the value is on screen either way.
  }
}
</script>

<template>
  <VacationSegmentCard
    :icon="item.icon"
    :title="item.title"
    :status="item.status"
    :past="item.timing?.phase === 'past'"
    :data-segment-id="item.id"
    :key-value="
      item.keyValue +
      (hint?.nightFlight === 'early-morning'
        ? ` · 🌙 ${t('travel.flight.earlyMorning')}`
        : hint?.nightFlight === 'late-night'
          ? ` · 🌙 ${t('travel.flight.lateNight')}`
          : '')
    "
    :collapsed="collapsed"
    :read-only="readOnly"
    show-edit
    deletable
    :hint="hint?.message"
    :attachment-count="item.photoIds?.length ?? 0"
    @update:title="emit('inline-save', item, 'title', $event)"
    @update:collapsed="emit('update:collapsed', item.id, $event)"
    @edit="emit('edit', item)"
    @delete="emit('delete', item)"
  >
    <!-- Header: a flight's live-check chip (always; in the row from `sm:`, on its own line
         below the title on a phone), and the compact avatar stack beside it when collapsed
         with a subset of travellers -->
    <template v-if="showChip || (item.showTravellers && collapsed)" #header-trailing>
      <span v-if="showChip && flightCheck" class="hidden min-w-0 shrink-0 sm:inline-flex">
        <FlightCheckChip
          :verification="flightCheck"
          :now-ms="clock"
          :reveals="chipReveals"
          @click="emit('show-notice', item)"
        />
      </span>
      <div
        v-if="item.showTravellers && collapsed"
        class="flex shrink-0 items-center pr-1"
        :title="travellerNamesLabel"
        :aria-label="travellerNamesLabel"
      >
        <MemberChip
          v-for="id in item.travellers"
          :key="id"
          :member-id="id"
          size="dot"
          class="-ml-1.5 first:ml-0"
        />
      </div>
    </template>

    <template v-if="showChip && flightCheck" #header-below>
      <div class="mt-1 flex min-w-0 sm:hidden">
        <FlightCheckChip
          :verification="flightCheck"
          :now-ms="clock"
          compact
          :reveals="chipReveals"
          @click="emit('show-notice', item)"
        />
      </div>
    </template>

    <!-- "When" hero band — date/time leads, above the detail rows. An airline change strikes
         out what it replaced (`was` is set only while the flight shows Changed). -->
    <SegmentWhenBand v-if="item.timing?.band" :band="item.timing.band" :was="flightCheck?.was" />

    <!-- Live flight checks: what the airline changed, disputes or cancelled -->
    <FlightChangeNotice
      v-if="showNotice && flightCheck && item.flight"
      :verification="flightCheck"
      :segment="item.flight"
      :now-ms="clock"
      @revert="emit('revert', item)"
      @take-airline="emit('take-airline', item)"
      @dismiss="emit('dismiss-notice', item)"
    />

    <!-- Expanded: always list who's travelling -->
    <div class="dark:divide-surface-overlay/40 divide-y divide-gray-100">
      <div v-if="item.travellers.length" class="flex items-center gap-3 py-1 first:pt-0 last:pb-0">
        <span
          class="font-outfit dark:text-ink-faint w-20 shrink-0 text-xs font-semibold text-gray-400 uppercase"
        >
          {{ t('vacation.field.travelling') }}
        </span>
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <MemberChip v-for="id in item.travellers" :key="id" :member-id="id" size="sm" />
        </div>
      </div>
      <div
        v-for="row in item.detailRows"
        :key="row.label"
        class="flex items-center gap-3 py-1 first:pt-0 last:pb-0"
      >
        <!-- Label -->
        <span
          class="font-outfit dark:text-ink-faint w-20 shrink-0 text-xs font-semibold text-gray-400 uppercase"
        >
          {{ row.label }}
        </span>

        <!-- Copyable value (booking ref only) -->
        <button
          v-if="row.copyable"
          class="font-outfit dark:bg-surface-overlay inline-flex items-center gap-1.5 rounded-lg border border-[var(--tint-slate-10)] bg-white px-2.5 py-0.5 text-sm font-semibold text-[var(--color-text)] transition-colors hover:border-[#00B4D8] hover:bg-[rgba(0,180,216,0.08)] dark:text-white"
          @click="copy(row.value)"
        >
          {{ row.value }}
          <span class="text-xs opacity-30">📋</span>
        </button>

        <!-- Inline-editable date/time — themed beanie pills. Night-flight
             hint renders alongside when a date field is a late-night or
             early-morning departure. -->
        <div
          v-else-if="row.field && row.inputType === 'date'"
          class="flex min-w-0 flex-wrap items-center gap-2"
        >
          <div class="max-w-[180px] min-w-0">
            <BeanieDatePicker
              :model-value="String(row.value ?? '')"
              @update:model-value="emit('inline-save', item, row.field!, $event)"
            />
          </div>
          <span
            v-if="hint?.nightFlight === 'early-morning'"
            class="font-outfit shrink-0 text-xs text-[var(--color-text-muted)]"
          >
            🌙 {{ t('travel.flight.earlyMorning') }}
          </span>
          <span
            v-else-if="hint?.nightFlight === 'late-night'"
            class="font-outfit shrink-0 text-xs text-[var(--color-text-muted)]"
          >
            🌙 {{ t('travel.flight.lateNight') }}
          </span>
        </div>

        <div v-else-if="row.field && row.inputType === 'time'" class="max-w-[140px] min-w-0 shrink">
          <BeanieTimePicker
            clearable
            :model-value="String(row.value ?? '')"
            @update:model-value="emit('inline-save', item, row.field!, $event)"
          />
        </div>

        <!-- Text / prose field — display-only with expand-to-read-more;
             edit via the ✏️ button on the card header -->
        <ExpandableText
          v-else-if="row.field"
          :text="String(row.value ?? '')"
          text-class="font-outfit text-sm font-medium text-gray-900 dark:text-ink"
        />

        <!-- Map link (entire row clickable) -->
        <a
          v-else-if="row.mapLink"
          :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.value)}`"
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 items-center gap-1.5"
        >
          <span class="truncate text-sm text-[#00B4D8] hover:underline">
            {{ row.value }}
          </span>
          <span class="shrink-0 text-xs opacity-40">📍</span>
        </a>

        <!-- Clickable link -->
        <div v-else-if="row.isLink" class="flex min-w-0 items-center gap-1.5">
          <!-- segment.link is MODEL OUTPUT (travel extraction shape), so it is
               attacker-influenceable. This read surface was missed in the first
               hardening pass while the edit modals were fixed. Falls back to
               plain text so a rejected link is still visible, not vanished. -->
          <a
            v-if="safeExternalHref(row.value)"
            :href="safeExternalHref(row.value)!"
            target="_blank"
            rel="noopener noreferrer"
            class="truncate text-sm text-[#00B4D8] hover:underline"
          >
            {{ row.value.replace(/^https?:\/\//, '') }}
          </a>
          <span v-else class="truncate text-sm opacity-70">{{ row.value }}</span>
          <span class="shrink-0 text-xs opacity-40">🔗</span>
        </div>

        <!-- Plain read-only value (a live flight value carries its "live" pill) -->
        <span v-else class="dark:text-ink text-sm text-gray-900">
          {{ row.value }}
          <span
            v-if="row.live"
            class="font-outfit text-secondary-500 dark:text-silk-lift ml-1.5 inline-flex items-center rounded-full bg-[var(--tint-silk-20)] px-1.5 text-xs font-semibold"
          >
            {{ t('travel.live.pill') }}
          </span>
        </span>
      </div>
    </div>

    <!-- Attached booking documents — thumbnail strip, opens the viewer -->
    <div
      v-if="item.photoIds && item.photoIds.length > 0"
      class="mt-3 flex items-center gap-2 overflow-x-auto pt-2"
    >
      <PhotoThumbnail
        v-for="pid in item.photoIds"
        :key="pid"
        :photo-id="pid"
        @open="emit('open-attachment', item.id, item.photoIds ?? [], pid)"
      />
    </div>

    <!-- Kinds that are never checked live say so, once, at the foot -->
    <p v-if="notLiveFootKey" class="text-secondary-400 dark:text-ink-faint mt-3 text-xs">
      {{ t(notLiveFootKey) }}
    </p>
  </VacationSegmentCard>
</template>
