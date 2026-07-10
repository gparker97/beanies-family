<script setup lang="ts">
/**
 * Renders the ONE badge a trip shows, from the pure `tripBadge()` decision.
 *
 * Exists so the discriminated union is narrowed in exactly one place. The two
 * surfaces that badge a trip (the travel list card and the trip detail header)
 * differ only in chrome, which is what `variant` selects — not in logic. The
 * nook keeps its own markup because its countdown is a hero badge, not a chip.
 *
 * Renders nothing when `badge` is null (no start date, or a malformed one), so
 * callers never need to gate an empty pill themselves.
 */
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { TripBadge } from '@/utils/vacation';

defineProps<{
  badge: TripBadge | null;
  /** `card`: light chip on a white card. `header`: translucent pill on the hero. */
  variant: 'card' | 'header';
}>();

const { t } = useTranslation();

function statusText(badge: Extract<TripBadge, { kind: 'status' }>): string {
  return fillTemplate(t(badge.textKey), badge.params ?? {});
}
</script>

<template>
  <span
    v-if="badge?.kind === 'countdown'"
    class="font-outfit inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-3 py-1 text-[0.6875rem] font-bold text-white"
    :class="
      variant === 'header'
        ? 'border-[1.5px] border-white/10 bg-white/16 bg-none px-4 py-1.5 backdrop-blur'
        : ''
    "
  >
    <span
      v-if="variant === 'header'"
      class="font-outfit text-xl leading-none font-extrabold text-[#FFD93D]"
    >
      {{ badge.days }}
    </span>
    <template v-else>{{ badge.emoji }} {{ badge.days }}</template>
    <span :class="variant === 'header' ? 'text-[0.6875rem] font-semibold text-white/70' : ''">
      {{ t(badge.labelKey as never) }}!
      <template v-if="variant === 'header'">{{ badge.emoji }}</template>
    </span>
  </span>

  <span
    v-else-if="badge?.kind === 'status'"
    class="font-outfit inline-flex items-center gap-1 rounded-full px-3 py-1 text-[0.6875rem] font-semibold"
    :class="
      variant === 'header'
        ? 'border-[1.5px] border-white/10 bg-white/16 px-4 py-1.5 text-white/70 backdrop-blur'
        : 'bg-[rgba(0,180,216,0.1)] text-[#0077B6]'
    "
  >
    {{ statusText(badge) }}
  </span>

  <span
    v-else-if="badge?.kind === 'completed'"
    class="font-outfit inline-flex items-center gap-1 text-[0.6875rem] font-semibold"
    :class="
      variant === 'header'
        ? 'rounded-full border-[1.5px] border-white/10 bg-white/16 px-4 py-1.5 text-white/70 backdrop-blur'
        : 'rounded-lg bg-[var(--tint-slate-5)] px-2.5 py-1 text-gray-400'
    "
  >
    ✓ {{ t('travel.completed') }}
  </span>
</template>
