<script setup lang="ts">
/**
 * Who Owns What (#109): the Overview's ring, cards dealt (held) out of the family's deck,
 * with the waiting share drawn faintly after it. Brand gradient on a slate track that has
 * its own dark partner. Animates up from 0 on mount; static under reduced motion.
 *
 * Single consumer, so it lives with the feature. Move it to `ui/` when a second appears.
 */
import { computed, onMounted, ref, useId } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ held: number; deck: number }>();

const { t } = useTranslation();
const gradientId = `deck-ring-${useId()}`;

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 0 → 1, flipped after mount so the stroke transitions up from nothing. */
const drawn = ref(prefersReducedMotion() ? 1 : 0);
onMounted(() => {
  if (drawn.value === 1) return;
  requestAnimationFrame(() => {
    drawn.value = 1;
  });
});

const heldLen = computed(() =>
  props.deck ? (props.held / props.deck) * CIRCUMFERENCE * drawn.value : 0
);
const waitingLen = computed(() =>
  props.deck ? ((props.deck - props.held) / props.deck) * CIRCUMFERENCE * drawn.value : 0
);
const label = computed(() =>
  fillTemplate(t('whoOwnsWhat.overview.ringLabel'), { held: props.held, deck: props.deck })
);
</script>

<template>
  <div class="relative h-36 w-36 shrink-0 sm:h-40 sm:w-40" role="img" :aria-label="label">
    <svg viewBox="0 0 100 100" class="h-full w-full -rotate-90" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F15D22" />
          <stop offset="1" stop-color="#E67E22" />
        </linearGradient>
      </defs>
      <circle class="track" cx="50" cy="50" :r="RADIUS" fill="none" stroke-width="11" />
      <circle
        class="arc"
        cx="50"
        cy="50"
        :r="RADIUS"
        fill="none"
        :stroke="`url(#${gradientId})`"
        stroke-width="11"
        stroke-linecap="round"
        :stroke-dasharray="`${heldLen} ${CIRCUMFERENCE}`"
      />
      <circle
        class="arc waiting"
        cx="50"
        cy="50"
        :r="RADIUS"
        fill="none"
        stroke-width="11"
        :stroke-dasharray="`${waitingLen} ${CIRCUMFERENCE}`"
        :stroke-dashoffset="-heldLen"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
      <span class="font-outfit dark:text-ink text-3xl font-extrabold text-[var(--color-text)]">
        {{ held
        }}<span class="dark:text-ink-faint text-base font-semibold text-[var(--color-text-muted)]"
          >/{{ deck }}</span
        >
      </span>
      <span class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.overview.dealt') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.track {
  stroke: rgb(44 62 80 / 8%);
}

html.dark .track {
  stroke: var(--color-surface-overlay);
}

.arc {
  transition:
    stroke-dasharray 0.9s cubic-bezier(0.2, 0.9, 0.3, 1),
    stroke-dashoffset 0.9s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.waiting {
  opacity: 0.3;
  stroke: #f15d22;
}

html.dark .waiting {
  stroke: var(--color-accent-lift);
}

@media (prefers-reduced-motion: reduce) {
  .arc {
    transition: none;
  }
}
</style>
