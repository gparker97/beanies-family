<script setup lang="ts">
/**
 * Who Owns What (#109): the Overview's ring, cards with a holder out of every card in play
 * (the whole set minus skipped), so it only fills as the deck is actually sorted. The rest
 * is drawn faintly after it: waiting, then (fainter still) the cards still to sort. The ring
 * itself (gradient, track with its dark partner, mount animation, reduced motion) is the shared
 * `ui/ProgressRing`; this keeps the label, the centre text and the sizes.
 */
import { computed } from 'vue';
import ProgressRing from '@/components/ui/ProgressRing.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ held: number; waiting: number; inPlay: number }>();

const { t } = useTranslation();

/** A share of everything in play. */
const share = (count: number) => (props.inPlay ? count / props.inPlay : 0);
const segments = computed(() => [
  { value: share(props.held), tone: 'fill' as const },
  { value: share(props.waiting), tone: 'soft' as const },
  { value: share(Math.max(0, props.inPlay - props.held - props.waiting)), tone: 'faint' as const },
]);
const label = computed(() =>
  fillTemplate(t('whoOwnsWhat.overview.ringLabel'), { held: props.held, total: props.inPlay })
);
</script>

<template>
  <ProgressRing
    :segments="segments"
    :stroke-width="11"
    class="h-36 w-36 shrink-0 sm:h-40 sm:w-40"
    role="img"
    :aria-label="label"
  >
    <div class="flex flex-col items-center justify-center" aria-hidden="true">
      <span class="font-outfit dark:text-ink text-3xl font-extrabold text-[var(--color-text)]">
        {{ held
        }}<span class="dark:text-ink-faint text-base font-semibold text-[var(--color-text-muted)]"
          >/{{ inPlay }}</span
        >
      </span>
      <span class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ t('whoOwnsWhat.overview.dealt') }}
      </span>
    </div>
  </ProgressRing>
</template>
