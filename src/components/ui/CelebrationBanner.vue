<script setup lang="ts">
/**
 * The in-page celebration card: the brand gradient with white ink, the celebrating beanies, a
 * title and body, a few fact pills, an optional slot (the choreboard's stars), an optional
 * action and an optional small note; every string arrives translated. First built for Who
 * Owns What (#109: the deal pile's "Every card has a holder!" and the check-in drawer's "Deck
 * checked"), shared since #146 by the choreboard's all-done banner, the home card's done line
 * and the wall's done strip.
 *
 * Dark mode (CIG slide 9, "or deliberately keeps its light ink"): the Heritage Orange →
 * Terracotta gradient is a fixed brand surface in BOTH themes (the CIG's Celebration
 * States; the Nook briefing hero, `FamilyStatusToast`, does the same), so nothing on it
 * switches. The pills and the action are solid white chips that also never switch, so
 * their ink is fixed too and deliberately has no `dark:` / `-lift` partner: a lift would
 * put a light accent on white. Measured on white: Deep Slate 11.0:1, `primary-700` 5.8:1.
 * Slot content sits on the gradient, so it must keep white ink in both themes too.
 */
withDefaults(
  defineProps<{
    title: string;
    body: string;
    pills?: string[];
    /** The one action. Absent = no button (a banner that only celebrates). */
    actionLabel?: string;
    note?: string;
    imageAlt: string;
    /**
     * The one-strip form (the wall's chore lanes, #146): a smaller picture and title, so a
     * finished block folds to a strip instead of taking half a lane.
     */
    compact?: boolean;
  }>(),
  { pills: () => [], actionLabel: '', note: '', compact: false }
);
defineEmits<{ action: [] }>();
</script>

<template>
  <div
    class="celebration-banner flex w-full flex-col items-center rounded-3xl text-center text-white"
    :class="compact ? 'gap-1 px-3 py-3' : 'gap-3 px-5 py-6'"
  >
    <img
      src="/brand/beanies_celebrating_line_transparent_560x225.png"
      :alt="imageAlt"
      :class="compact ? 'w-24' : 'w-44'"
    />
    <h3
      class="font-outfit leading-tight font-extrabold text-balance"
      :class="compact ? 'text-lg' : 'text-2xl'"
    >
      {{ title }}
    </h3>
    <p :class="compact ? 'text-xs' : 'text-sm'">{{ body }}</p>
    <div v-if="pills.length" class="flex flex-wrap justify-center gap-1.5">
      <span
        v-for="pill in pills"
        :key="pill"
        class="font-outfit text-secondary-500 rounded-full bg-white px-2.5 py-1 text-xs font-semibold"
        >{{ pill }}</span
      >
    </div>
    <slot />
    <button
      v-if="actionLabel"
      type="button"
      class="font-outfit text-primary-700 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold"
      data-testid="celebration-banner-action"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
    <small v-if="note" class="text-xs">{{ note }}</small>
  </div>
</template>

<style scoped>
.celebration-banner {
  background: linear-gradient(135deg, #f15d22, #e67e22);
  box-shadow: 0 8px 24px rgb(241 93 34 / 30%);
}
</style>
