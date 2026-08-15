<script setup lang="ts">
// External-calendar clash indicator (#34). PURELY presentational — receives a
// resolved clash (or undefined) as a prop and self-gates: renders nothing when
// there's no clash. Self-gating (vs a parent `v-if`) lets every call site — including
// the `v-for` grid surfaces — resolve the clash exactly ONCE. It does NOT read any
// store (coupling lives only in `useClash`).
//
// ONE MARK, EVERY SURFACE (2026-08-15). This used to have a second `chip` variant
// that also rendered the clashing calendar's NAME in a tinted pill. On a narrow
// mobile week column that pill took most of the title row — "Softball batting cage"
// rendered as "Softball ba…" — because the pill is `flex-shrink-0` and the title
// is not, so the title absorbed all the compression. The label was answering a
// question the user hasn't asked yet: on a grid they are scanning "what's on?",
// which is the title. "Which calendar?" is a drill-down, and the drawer already
// answers it in full WITH the actions attached ("Overlaps your <x> calendar" /
// "This is OK" / "Reschedule…"). So: the grid signals, the drawer explains.
//
// Deliberately NOT a shrinkable label — a name compressed to "greg…" costs nearly
// the same title space and communicates nothing.
//
// Two states, told apart by opacity alone now that both are the same shape:
//   • active (unacknowledged) — solid.
//   • quiet  (acknowledged)   — 40%. NOT higher: the previous 70% was legible only
//     because the active state was a differently-SHAPED pill; against a solid mark
//     it reads as the same thing.
//
// Discoverability without the label rests on three legs, all preserved below:
// the mark is a distinctive motif reused in the drawer callout (learnable, not a
// generic warning glyph); `role="img"` + `aria-label` keep the full sentence for
// screen readers and the desktop tooltip; and tapping opens the drawer.
//
// Heritage Orange throughout, never Alert Red — a clash is information, not a failure.
// Trailing, never leading: a leading mark would shift each title's start position
// depending on whether it clashes, breaking the vertical scan down a column.
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import OverlapMark from './OverlapMark.vue';
import type { ResolvedClash } from '@/composables/useClash';

const props = defineProps<{ clash?: ResolvedClash }>();
const { t } = useTranslation();

const tooltip = computed(() =>
  props.clash ? `${t('calendarSync.clash.tooltipPrefix')} ${props.clash.calendarLabel}` : ''
);
</script>

<template>
  <span
    v-if="clash"
    class="inline-flex flex-shrink-0 items-center"
    role="img"
    :aria-label="tooltip"
    :title="tooltip"
  >
    <OverlapMark
      class="text-primary-500 h-3 w-auto"
      :class="{ 'opacity-40': clash.acknowledged }"
    />
  </span>
</template>
