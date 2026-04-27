<script setup lang="ts">
/**
 * Medication card — pharmacy-shelf aesthetic. Photo anchors the left
 * when one exists; without a photo a brand-colored capsule illustration
 * takes over the slot so the card never feels half-empty.
 *
 * A 4px status spine on the left edge + a color-coded chip up top both
 * signal active/ended state. Ended meds dim to 60% opacity — that
 * pattern carries over from the previous flat card.
 *
 * Structure: the card is a `<div>` wrapping two sibling buttons — a
 * full-width body button that emits `view`, and a small 💊 quick-action
 * button (top-right on active meds only) that emits `give-dose` with
 * `@click.stop` so the two tap targets never collide. The ended meds
 * hide the dose button entirely: no accidental logging on a med the
 * family has stopped taking.
 *
 * Emits:
 *   @view       — user tapped the card body (opens the view modal)
 *   @give-dose  — user tapped the 💊 quick-action (parent orchestrates
 *                 the dose flow via `useGiveDose`)
 */
import { computed } from 'vue';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import { isMedicationActive } from '@/stores/medicationsStore';
import { useToday } from '@/composables/useToday';
import type { Medication } from '@/types/models';

const props = defineProps<{ medication: Medication }>();
defineEmits<{
  view: [];
  'give-dose': [medication: Medication];
}>();

const { t } = useTranslation();
const { url: photoUrl } = useAvatarPhotoUrl(() => props.medication.photoIds?.[0]);
const { today } = useToday();

const isActive = computed(() => isMedicationActive(props.medication, today.value));

const scheduleLabel = computed(() => {
  const m = props.medication;
  if (m.ongoing) return null;
  const parts: string[] = [];
  if (m.startDate) parts.push(m.startDate);
  if (m.endDate) parts.push(`→ ${m.endDate}`);
  return parts.length ? parts.join(' ') : null;
});
</script>

<template>
  <div
    class="group relative overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--card-shadow)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    :class="{ 'opacity-60': !isActive }"
  >
    <!-- Status spine — Sky Silk for active (calm, ongoing care), slate for ended -->
    <span
      class="absolute top-0 bottom-0 left-0 z-[1] w-1"
      :class="isActive ? 'bg-[#AED6F1]' : 'bg-slate-300 dark:bg-slate-600'"
      aria-hidden="true"
    />

    <!-- Body button — emits `view`. The 💊 action button sits as a
         sibling (NOT nested) so both are valid, keyboard-reachable
         tap targets and `@click.stop` on the action cleanly isolates
         the two. -->
    <button
      type="button"
      class="flex w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2"
      @click="$emit('view')"
    >
      <!-- Visual anchor: photo OR apothecary fallback -->
      <div
        class="relative aspect-square w-24 flex-shrink-0 overflow-hidden sm:w-28"
        :class="photoUrl ? 'bg-slate-100 dark:bg-slate-900' : ''"
      >
        <img
          v-if="photoUrl"
          :src="photoUrl"
          :alt="medication.name"
          class="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          v-else
          class="absolute inset-0 flex items-center justify-center overflow-hidden"
          style="
            background: linear-gradient(
              135deg,
              rgb(174 214 241 / 35%) 0%,
              rgb(248 249 250 / 100%) 55%,
              rgb(230 126 34 / 14%) 100%
            );
          "
        >
          <!-- Diagonal hatch texture (prescription paper feel) -->
          <span
            class="absolute inset-0"
            style="
              background-image: repeating-linear-gradient(
                -45deg,
                transparent 0,
                transparent 10px,
                rgb(44 62 80 / 4%) 10px,
                rgb(44 62 80 / 4%) 11px
              );
            "
            aria-hidden="true"
          />
          <!-- Rx watermark -->
          <span
            class="font-outfit absolute top-1.5 left-2 text-[9px] font-bold tracking-[0.2em] text-[#F15D22]/45"
            aria-hidden="true"
          >
            Rx
          </span>
          <!-- Two-tone capsule pill — brand orange + white halves -->
          <svg
            viewBox="0 0 48 24"
            class="relative h-9 w-[4.5rem] drop-shadow-sm transition-transform duration-500 group-hover:-rotate-[8deg]"
            aria-hidden="true"
          >
            <defs>
              <clipPath :id="`pill-clip-${medication.id}`">
                <rect x="0" y="0" width="48" height="24" rx="12" />
              </clipPath>
              <linearGradient :id="`pill-grad-${medication.id}`" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#F15D22" />
                <stop offset="100%" stop-color="#D14D1A" />
              </linearGradient>
            </defs>
            <g :clip-path="`url(#pill-clip-${medication.id})`">
              <rect x="0" y="0" width="24" height="24" :fill="`url(#pill-grad-${medication.id})`" />
              <rect x="24" y="0" width="24" height="24" fill="#FFFFFF" />
              <line x1="24" y1="0" x2="24" y2="24" stroke="rgba(44,62,80,0.2)" stroke-width="0.5" />
            </g>
            <rect
              x="0"
              y="0"
              width="48"
              height="24"
              rx="12"
              fill="none"
              stroke="rgba(44,62,80,0.15)"
              stroke-width="0.5"
            />
          </svg>
        </div>
      </div>

      <!-- Content block. ACTIVE state is implicit — sky-silk spine + full
           opacity + the visible 💊 button already say "currently being
           given," so we only label the abnormal state (ENDED). This
           also frees the top-right corner so the 💊 quick-action has a
           clean anchor without overlapping a badge.

           On active meds, `pr-14` reserves space for the absolute-
           positioned 💊 so long names/notes don't run under it. -->
      <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-4" :class="{ 'pr-14': isActive }">
        <div class="flex items-start justify-between gap-2">
          <h4
            class="font-outfit truncate text-base leading-tight font-bold text-[#2C3E50] dark:text-gray-100"
          >
            {{ medication.name }}
          </h4>
          <span
            v-if="!isActive"
            class="font-outfit flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase dark:bg-slate-700 dark:text-slate-400"
          >
            {{ t('medications.ended') }}
          </span>
        </div>
        <p class="font-outfit text-sm font-medium text-[#2C3E50]/75 dark:text-gray-300">
          <span class="font-semibold">{{ medication.dose }}</span>
          <span class="mx-1.5 text-[#2C3E50]/30" aria-hidden="true">·</span>
          <span>{{ medication.frequency }}</span>
        </p>
        <p
          v-if="scheduleLabel"
          class="font-outfit text-[10px] font-semibold tracking-[0.1em] text-[#2C3E50]/50 uppercase"
        >
          {{ scheduleLabel }}
        </p>
        <p
          v-if="medication.notes"
          class="font-inter line-clamp-2 text-xs leading-snug text-[#2C3E50]/60 italic dark:text-gray-400"
        >
          "{{ medication.notes }}"
        </p>
      </div>
    </button>

    <!-- Dose quick-action — hidden on ended meds (safety: no logging
         on stopped medications). Positioned outside the body button so
         tap targets never collide. -->
    <button
      v-if="isActive"
      type="button"
      :aria-label="t('medicationLog.giveDose')"
      :title="t('medicationLog.giveDose')"
      class="absolute top-3 right-3 z-[2] flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--tint-orange-8)] text-lg transition-colors hover:bg-[var(--tint-orange-15)] focus:bg-[var(--tint-orange-15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F15D22] focus-visible:ring-offset-2"
      @click.stop="$emit('give-dose', medication)"
    >
      💊
    </button>
  </div>
</template>
