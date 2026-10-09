<script setup lang="ts">
/**
 * Night: dim the room, keep the time readable, and say what tomorrow holds.
 *
 * The look-ahead line is the reason to glance at a dark kitchen at 11pm — it
 * is the last thing a parent checks before bed, and the mockup puts it right
 * under the clock for exactly that reason.
 *
 * An OVERLAY above the live view rather than a replacement, so the wall does
 * not remount (and re-fetch) every morning. Brand sits in the corner
 * deliberately — it reinforces whose display this is without competing with
 * the only information that matters at 2am.
 */
import { useTranslation } from '@/composables/useTranslation';
import HandwrittenLine from '@/components/ui/HandwrittenLine.vue';

defineProps<{
  time: string;
  date: string;
  /** How many things are on tomorrow — drives the look-ahead line. */
  tomorrowCount: number;
}>();
defineEmits<{ wake: [] }>();
const { t } = useTranslation();
</script>

<template>
  <div
    class="absolute inset-0 z-[50] flex flex-col items-center justify-center bg-[radial-gradient(120%_90%_at_50%_30%,#16202c,#0d141d)] text-[#e7edf3]"
    @click="$emit('wake')"
  >
    <p class="font-outfit wall-night-time leading-none font-extrabold tracking-tight">{{ time }}</p>
    <p class="font-outfit wall-night-date mt-1 font-semibold text-[#8ea3b8]">{{ date }}</p>
    <!--
      Tomorrow's count is the wall's one handwritten line at night, matching "N things on
      today" in the day header. A warm lifted Terracotta: the only colour on a dark screen,
      and gentle enough for a dim room.
    -->
    <HandwrittenLine
      v-if="tomorrowCount"
      tag="p"
      :template="
        tomorrowCount === 1 ? t('wall.night.tomorrow.one') : t('wall.night.tomorrow.other')
      "
      :values="{ count: tomorrowCount }"
      class="wall-night-hand text-terracotta-lift mt-5"
    />
    <p class="font-inter wall-night-hint text-[#63798f]" :class="tomorrowCount ? 'mt-2' : 'mt-5'">
      {{ t('wall.night.wake') }}
    </p>

    <div class="absolute bottom-8 left-8 flex items-center gap-3 opacity-55">
      <img
        src="/brand/beanies_family_icon_transparent_384x384.png"
        alt=""
        class="h-8 w-8 object-contain"
      />
      <span class="font-outfit wall-night-brand font-bold text-[#8ea3b8]">
        beanies<span class="text-[var(--heritage-orange)]">.family</span>
      </span>
    </div>
  </div>
</template>
