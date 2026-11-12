<script setup lang="ts">
/**
 * A bean's face on the wall that opens the family scrapbook (#140).
 *
 * Wraps markup the caller already has (an avatar, or a face-and-name chip) without changing
 * it. With the viewer on it is a real `<button>` with a translated `aria-label`; with the
 * viewer off, or outside a wall (no `WALL_MEMORIES` provider), it is the same `<span>` with
 * nothing to tap, which is what these faces were before. The caller's classes land on
 * whichever element renders, so the layout is the same either way: a button here has no
 * padding, border or background of its own (preflight), and only gains a pointer and a
 * focus outline (an outline, not a ring, because a ring's offset paints white on dark).
 *
 * The viewer always opens on everyone, whichever face was tapped, so the label names the
 * bean (for orientation) and says what the tap does.
 */
import { computed, inject } from 'vue';
import { WALL_MEMORIES } from '@/components/wall/wallMemoriesKey';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { WallMemoriesOpenSource } from '@/composables/useWallMemories';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The bean's name, for the accessible label. */
  name: string;
  source: Extract<WallMemoriesOpenSource, 'face-chore' | 'face-sheet'>;
}>();

const memories = inject(WALL_MEMORIES, null);
const { t } = useTranslation();

const enabled = computed(() => memories?.enabled.value === true);
const label = computed(() => fillTemplate(t('wall.memories.openFor'), { name: props.name }));

function onClick(event: MouseEvent): void {
  memories?.open(props.source, event.currentTarget as Element | null);
}
</script>

<template>
  <button
    v-if="enabled"
    v-bind="$attrs"
    type="button"
    class="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AED6F1]"
    :aria-label="label"
    aria-haspopup="dialog"
    @click="onClick"
  >
    <slot />
  </button>
  <span v-else v-bind="$attrs">
    <slot />
  </span>
</template>
