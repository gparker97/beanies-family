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
 */
import { computed } from 'vue';
import VacationSegmentCard from '@/components/vacation/VacationSegmentCard.vue';
import SegmentWhenBand from '@/components/travel/SegmentWhenBand.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import PhotoThumbnail from '@/components/media/PhotoThumbnail.vue';
import ExpandableText from '@/components/ui/ExpandableText.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BeanieTimeInput from '@/components/ui/BeanieTimeInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { safeExternalHref } from '@/utils/url';
import type { TimelineItem } from '@/composables/useVacationTimeline';

const props = defineProps<{
  item: TimelineItem;
  collapsed: boolean;
  readOnly: boolean;
  /** The hint for THIS item, already resolved by the page — not the whole map. */
  hint?: { message?: string; nightFlight?: 'early-morning' | 'late-night' } | undefined;
}>();

const emit = defineEmits<{
  'inline-save': [item: TimelineItem, field: string, value: string];
  edit: [item: TimelineItem];
  delete: [item: TimelineItem];
  'update:collapsed': [id: string, collapsed: boolean];
  'open-attachment': [segmentId: string, photoIds: string[], photoId: string];
}>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();

const travellerNamesLabel = computed(() =>
  props.item.travellers.map((id) => getMemberName(id)).join(', ')
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
    <!-- Collapsed: a compact avatar stack, only when travellers are a subset -->
    <template v-if="item.showTravellers && collapsed" #header-trailing>
      <div
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

    <!-- "When" hero band — date/time leads, above the detail rows -->
    <SegmentWhenBand v-if="item.timing?.band" :band="item.timing.band" />

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
          <BeanieTimeInput
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

        <!-- Plain read-only value -->
        <span v-else class="dark:text-ink text-sm text-gray-900">
          {{ row.value }}
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
  </VacationSegmentCard>
</template>
