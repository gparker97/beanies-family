<script setup lang="ts">
/**
 * Who Owns What (#109): the in-page celebration card (mockup sections 9 and 10), shared by
 * the deal pile ("Every card has a holder!") and the check-in drawer ("Deck checked"). The
 * brand gradient with white ink, the celebrating beanies, a few fact pills, one action and
 * an optional small note. The gradient is a brand surface in both modes, so it keeps its
 * colours on dark; every string arrives translated.
 */
withDefaults(
  defineProps<{
    title: string;
    body: string;
    pills?: string[];
    actionLabel: string;
    note?: string;
    imageAlt: string;
  }>(),
  { pills: () => [], note: '' }
);
defineEmits<{ action: [] }>();
</script>

<template>
  <div
    class="deck-celebration flex w-full flex-col items-center gap-3 rounded-3xl px-5 py-6 text-center text-white"
  >
    <img
      src="/brand/beanies_celebrating_line_transparent_560x225.png"
      :alt="imageAlt"
      class="w-44"
    />
    <h3 class="font-outfit text-2xl leading-tight font-extrabold text-balance">{{ title }}</h3>
    <p class="text-sm">{{ body }}</p>
    <div v-if="pills.length" class="flex flex-wrap justify-center gap-1.5">
      <span
        v-for="pill in pills"
        :key="pill"
        class="font-outfit text-secondary-500 rounded-full bg-white px-2.5 py-1 text-xs font-semibold"
        >{{ pill }}</span
      >
    </div>
    <button
      type="button"
      class="font-outfit rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#C2410C]"
      data-testid="deck-celebration-action"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
    <small v-if="note" class="text-xs">{{ note }}</small>
  </div>
</template>

<style scoped>
.deck-celebration {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  box-shadow: 0 8px 24px rgb(241 93 34 / 30%);
}
</style>
