<script setup lang="ts">
/**
 * Medication card — pharmacy-shelf aesthetic. Photo anchors the left
 * when one exists; without a photo a brand-colored capsule illustration
 * takes over the slot so the card never feels half-empty.
 *
 * A 4px status spine on the left edge + a color-coded chip up top both
 * signal active/ended state. Ended meds dim to 60% opacity — that
 * pattern carries over from the previous flat card.
 */
import { computed } from 'vue';
import { useAvatarPhotoUrl } from '@/composables/useAvatarPhotoUrl';
import { useTranslation } from '@/composables/useTranslation';
import type { Medication } from '@/types/models';

const props = defineProps<{ medication: Medication }>();
defineEmits<{ click: [] }>();

const { t } = useTranslation();
const { url: photoUrl } = useAvatarPhotoUrl(() => props.medication.photoIds?.[0]);

const isActive = computed(() => {
  const m = props.medication;
  if (m.ongoing) return true;
  const today = new Date().toISOString().slice(0, 10);
  if (m.endDate && m.endDate < today) return false;
  if (m.startDate && m.startDate > today) return false;
  return true;
});

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
  <button
    type="button"
    class="group relative flex overflow-hidden rounded-[var(--sq)] bg-white text-left shadow-[var(--card-shadow)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    :class="{ 'opacity-60': !isActive }"
    @click="$emit('click')"
  >
    <!-- Status spine — Sky Silk for active (calm, ongoing care), slate for ended -->
    <span
      class="absolute top-0 bottom-0 left-0 w-1"
      :class="isActive ? 'bg-[#AED6F1]' : 'bg-slate-300 dark:bg-slate-600'"
      aria-hidden="true"
    />

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

    <!-- Content block -->
    <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
      <div class="flex items-start justify-between gap-2">
        <h4
          class="font-outfit truncate text-base leading-tight font-bold text-[#2C3E50] dark:text-gray-100"
        >
          {{ medication.name }}
        </h4>
        <span
          class="font-outfit flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
          :class="
            isActive
              ? 'bg-[#AED6F1]/35 text-[#1E5A85] dark:bg-[#AED6F1]/15 dark:text-[#AED6F1]'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
          "
        >
          {{ isActive ? t('medications.active') : t('medications.ended') }}
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
</template>
