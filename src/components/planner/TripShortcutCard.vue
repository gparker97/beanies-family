<script setup lang="ts">
/**
 * The "Planning a trip?" shortcut shown at the top of a NEW activity modal — it
 * hands off to the vacation wizard. Two presentations from one definition so the
 * copy, colours, and emit live in a single place:
 *   - `compact` → a vertical card sized for the two-up Quick-start grid (beside
 *     the "Perform magic" card when the photo reader is available).
 *   - default → the original full-width horizontal row (shown when the reader is
 *     unavailable — i.e. today's behaviour, unchanged).
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ compact?: boolean }>();
defineEmits<{ start: [] }>();

const { t } = useTranslation();
</script>

<template>
  <button
    v-if="compact"
    type="button"
    class="flex cursor-pointer flex-col gap-1 rounded-2xl border p-3 text-left transition-all duration-200 hover:shadow-sm"
    style="
      background: linear-gradient(135deg, rgb(0 180 216 / 12%), rgb(255 217 61 / 10%));
      border-color: rgb(0 180 216 / 18%);
    "
    @click="$emit('start')"
  >
    <span aria-hidden="true" class="text-lg leading-none">🏖️</span>
    <span class="font-outfit text-sm font-bold" style="color: var(--vacation-teal)">
      {{ t('vacation.planningATrip') }}
    </span>
    <span class="text-xs leading-snug text-[var(--color-text-muted)] opacity-60">
      {{ t('vacation.planningSubtitle') }}
    </span>
  </button>

  <button
    v-else
    type="button"
    class="w-full cursor-pointer rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:shadow-sm"
    style="
      background: linear-gradient(135deg, rgb(0 180 216 / 12%), rgb(255 217 61 / 10%));
      border-color: rgb(0 180 216 / 18%);
    "
    @click="$emit('start')"
  >
    <div class="flex items-center gap-3">
      <span class="text-xl" style="animation: sway 3s ease-in-out infinite">🏖️</span>
      <div class="min-w-0 flex-1">
        <span class="font-outfit block text-xs font-semibold" style="color: var(--vacation-teal)">
          {{ t('vacation.planningATrip') }}
        </span>
        <span class="block text-xs text-[var(--color-text-muted)] opacity-60">
          {{ t('vacation.planningSubtitle') }}
        </span>
      </div>
      <span class="text-sm font-semibold" style="color: var(--vacation-teal)">›</span>
    </div>
  </button>
</template>
