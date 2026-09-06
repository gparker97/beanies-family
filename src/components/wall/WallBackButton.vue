<script setup lang="ts">
/**
 * The way back, named after where you came from.
 *
 * ⚠️ Written out twice, byte for byte — in the today view and on the jobs board
 * — inside the very change that extracted `WallNavArrow` to stop exactly that.
 * The two copies shared a class list, a translation key, a `fillTemplate` call
 * and a chevron, which is four things to keep in step by memory.
 *
 * It carries NO chrome of its own beyond `.wall-back`, which `BeanieWallPage`
 * styles through `:deep()`: its rem sizing, its 44px target floor and its
 * dark-mode partner all come across intact.
 *
 * Existing at all is greg's call, over my recommendation that the
 * always-visible view switcher made a back control unnecessary.
 */
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';

defineProps<{
  /** The view this returns to, already lowercased by the page. */
  backLabel: string;
}>();

const emit = defineEmits<{ back: [] }>();

const { t } = useTranslation();
</script>

<template>
  <button
    type="button"
    class="font-outfit text-secondary-500 wall-back dark:bg-surface-raised dark:text-ink shrink-0 rounded-2xl bg-white px-4 py-2.5 font-bold shadow-[var(--card-shadow)]"
    @click="emit('back')"
  >
    ‹ {{ fillTemplate(t('wall.jobsBoard.back'), { view: backLabel }) }}
  </button>
</template>
