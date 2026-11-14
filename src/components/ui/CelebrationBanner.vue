<script setup lang="ts">
/**
 * The in-page celebration card: the brand gradient with white ink, the celebrating beanies, a
 * title and body, a few fact pills, an optional star row (`stars`), an optional slot, an
 * optional action and an optional small note; every string arrives translated. First built for
 * Who Owns What (#109: the deal pile's "Every card has a holder!" and the check-in drawer's
 * "Deck checked"), shared since #146 by the choreboard's all-done banner and the wall's done
 * strip.
 *
 * The chore celebration (#146) plays ON this banner: while `celebration` is set, the picture,
 * the title and body and the action are hidden (the beanies do their move above the banner), the
 * praise line sits where the words go, and the stars wait unlit until each one lands
 * (`ChoreCelebration.vue` animates them, finding them by their `data-celebration-*` hooks). With
 * `celebration.calm` (reduced motion) the stars are lit and only the words are swapped. Nothing
 * here changes size between the two forms, so the banner never jumps when it settles.
 *
 * Dark mode (CIG slide 9, "or deliberately keeps its light ink"): the Heritage Orange →
 * Terracotta gradient is a fixed brand surface in BOTH themes (the CIG's Celebration
 * States; the Nook briefing hero, `FamilyStatusToast`, does the same), so nothing on it
 * switches. The pills and the action are solid white chips that also never switch, so
 * their ink is fixed too and deliberately has no `dark:` / `-lift` partner: a lift would
 * put a light accent on white. Measured on white: Deep Slate 11.0:1, `primary-700` 5.8:1.
 * Slot content and the praise line sit on the gradient, so they keep white ink in both themes.
 */
import { computed } from 'vue';
import { praiseWords, type BannerCelebration } from '@/utils/choreCelebration';

const props = withDefaults(
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
    /** A row of this many stars (the choreboard: one per chore). */
    stars?: number;
    /** The chore celebration is playing on this banner (#146). */
    celebration?: BannerCelebration | null;
  }>(),
  { pills: () => [], actionLabel: '', note: '', compact: false, stars: 0, celebration: null }
);
defineEmits<{ action: [] }>();

const words = computed(() =>
  props.celebration ? praiseWords(props.celebration.praise, props.celebration.name) : []
);
const formClass = computed(() => {
  if (!props.celebration) return '';
  return props.celebration.calm ? 'is-calm' : 'is-celebrating';
});
</script>

<template>
  <div
    class="celebration-banner flex w-full flex-col items-center rounded-3xl text-center text-white"
    :class="[compact ? 'gap-1 px-3 py-3' : 'gap-3 px-5 py-6', formClass]"
    data-celebration-banner
  >
    <img
      src="/brand/beanies_celebrating_line_transparent_560x225.png"
      :alt="imageAlt"
      :class="compact ? 'w-24' : 'w-44'"
      data-celebration-picture
    />
    <div class="relative w-full">
      <div
        class="flex flex-col items-center"
        :class="compact ? 'gap-1' : 'gap-3'"
        data-celebration-std
      >
        <h3
          class="font-outfit leading-tight font-extrabold text-balance"
          :class="compact ? 'text-lg' : 'text-2xl'"
        >
          {{ title }}
        </h3>
        <p :class="compact ? 'text-xs' : 'text-sm'">{{ body }}</p>
      </div>
      <!--
        Anchored to the bottom of the words, so the banner keeps its settled height; a long line
        grows up into the picture's space, which is empty while the beanies are out.
      -->
      <p
        v-if="celebration"
        class="font-outfit absolute inset-x-0 bottom-0 text-xl leading-tight font-extrabold text-balance"
        aria-hidden="true"
        data-celebration-praise
      >
        <span
          v-for="(w, i) in words"
          :key="i"
          class="banner-praise-word inline-block"
          data-praise-word
          :data-praise-name="w.name ? 'true' : undefined"
          >{{ w.text }}</span
        >
      </p>
    </div>
    <div v-if="pills.length" class="flex flex-wrap justify-center gap-1.5">
      <span
        v-for="pill in pills"
        :key="pill"
        class="font-outfit text-secondary-500 rounded-full bg-white px-2.5 py-1 text-xs font-semibold"
        >{{ pill }}</span
      >
    </div>
    <p
      v-if="stars > 0"
      class="flex flex-wrap justify-center gap-0.5 leading-none"
      :class="compact ? 'text-lg' : 'text-2xl'"
      aria-hidden="true"
      data-celebration-stars
    >
      <span
        v-for="n in stars"
        :key="n"
        class="banner-star relative inline-block"
        data-celebration-star
        ><span class="banner-star-lit inline-block" data-celebration-star-lit>⭐</span></span
      >
    </p>
    <slot />
    <button
      v-if="actionLabel"
      type="button"
      class="banner-action font-outfit text-primary-700 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold"
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

.banner-praise-word {
  margin: 0 0.12em;
}

/* The unlit star under each slot: drawn only while the celebration waits for it to land. */
.banner-star::before {
  content: '⭐';
  filter: grayscale(1) brightness(1.8);
  inset: 0;
  opacity: 0;
  position: absolute;
}

.is-celebrating .banner-star::before {
  opacity: 0.4;
}

/* Lit by ChoreCelebration as each star lands (an opacity animation that holds its end). */
.is-celebrating .banner-star-lit,
.is-celebrating [data-celebration-picture],
.is-celebrating [data-celebration-std],
.is-celebrating .banner-action,
.is-calm [data-celebration-std] {
  opacity: 0;
}
</style>
