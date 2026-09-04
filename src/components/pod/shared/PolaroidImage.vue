<script setup lang="ts">
/**
 * White-bordered polaroid-style photo with an optional handwritten
 * caption. Used on recipe hero shots, cook log dish snaps, and
 * scrapbook photo items. When `src` is null the component renders
 * a soft terracotta kraft-paper illustration placeholder so
 * photo-less recipes still look intentional rather than empty.
 */
const props = defineProps<{
  src?: string | null;
  /** Optional Caveat-styled caption shown inside the white border. */
  caption?: string;
  /** Accessible alt text for the image. */
  alt?: string;
  /** Aspect ratio override — defaults to 4/3, photo-album shape. */
  aspectRatio?: string;
  /**
   * A photo is on its way into this frame. Renders the same spinner treatment the app
   * already uses while a photo uploads, so "a picture is coming" looks the same wherever
   * it happens — and so a user does not start adding one of their own on top.
   */
  loading?: boolean;
  /**
   * Stable seed for the no-photo placeholder's glyph and tint (#86).
   *
   * Pass the recipe id. The same seed always yields the same drawing, so one recipe keeps one
   * look; different seeds spread across the set, so a cookbook grid of un-photographed
   * recipes reads as a house style rather than one broken image repeated down the page.
   *
   * OMITTED = today's exact appearance (the cloche, in Terracotta), so every other caller —
   * cook logs, the scrapbook — is untouched by this.
   */
  variantSeed?: string;
}>();

import { computed, ref, watch, onUnmounted } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { PLACEHOLDER_GLYPHS, PLACEHOLDER_TINTS } from './polaroidPlaceholder';
import { stableIndex } from '@/utils/stableVariant';

/** The glyph for this frame. Index 0 — the original cloche — when no seed is given. */
const glyph = computed(() =>
  props.variantSeed
    ? PLACEHOLDER_GLYPHS[stableIndex(props.variantSeed, PLACEHOLDER_GLYPHS.length)]
    : PLACEHOLDER_GLYPHS[0]
);

/**
 * ⚠️ INLINE STYLE, NEVER A COMPUTED TAILWIND CLASS.
 *
 * The obvious `:class="`text-[${tint}]`"` does not work and fails SILENTLY: Tailwind scans
 * source at build time, so a class assembled at runtime generates no CSS at all. `stroke` is
 * `currentColor`, so the glyph would quietly inherit whatever colour the parent happens to
 * have — a subtly wrong tint that no unit test can catch.
 */
const tint = computed(() =>
  props.variantSeed
    ? PLACEHOLDER_TINTS[stableIndex(props.variantSeed, PLACEHOLDER_TINTS.length)]
    : PLACEHOLDER_TINTS[0]
);

/**
 * A JUST-UPLOADED photo is not immediately servable.
 *
 * Photo URLs here are `lh3.googleusercontent.com/d/<driveFileId>` built synchronously from
 * the id the moment the upload completes — but Drive still has to publish the file and the
 * CDN has to pick it up, which takes a few seconds. Open a freshly-captured recipe straight
 * away and the image 404s.
 *
 * Without this, that failure was invisible and confusing: the `<img>` rendered as a blank
 * box with the caption floating over it, which reads as "the photo saved wrong" rather than
 * "the photo is still arriving". Retrying with backoff covers the propagation window, and
 * the frame shows its normal "a photo is coming" treatment meanwhile — the same thing it
 * shows before the upload starts, so the whole wait looks like one continuous state.
 *
 * Bounded: after the last attempt the frame settles into the empty placeholder rather than
 * retrying forever, because a genuinely missing photo must not spin indefinitely.
 */
const RETRY_DELAYS_MS = [700, 1500, 3000];

const attempt = ref(0);
const retrying = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

/** Show the arriving-photo treatment while the caller says so OR while we are retrying. */
const showLoading = computed(() => props.loading === true || retrying.value);

function clearTimer(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function onImageError(): void {
  const delay = RETRY_DELAYS_MS[attempt.value];
  if (delay === undefined) {
    // Out of attempts. Fall back to the empty frame — honest, and it stops the caption
    // hovering over a broken image.
    failed.value = true;
    retrying.value = false;
    return;
  }
  retrying.value = true;
  clearTimer();
  timer = setTimeout(() => {
    // Bumping `attempt` re-keys the <img>, so the browser issues a fresh request rather
    // than serving its cached 404.
    attempt.value += 1;
    retrying.value = false;
  }, delay);
}

// A new photo starts its own attempt budget.
watch(
  () => props.src,
  () => {
    clearTimer();
    attempt.value = 0;
    retrying.value = false;
    failed.value = false;
  }
);

onUnmounted(clearTimer);
</script>

<template>
  <figure
    class="relative bg-white p-2 pb-7 shadow-[var(--card-shadow)]"
    style="
      box-shadow:
        inset 0 0 0 1px rgb(44 62 80 / 5%),
        var(--card-shadow);
    "
  >
    <!--
      `referrerpolicy="no-referrer"` strips the Referer so Google's lh3
      CDN rate-limits by IP rather than per-origin. Polaroid images come
      from the photo store (recipes, scrapbook), which means lh3 URLs
      under the hood. See BeanieAvatar.vue for the full rationale.
    -->
    <!-- Spinner wins over both the image and the placeholder: while a photo is arriving,
         that fact is the most useful thing the frame can say.

         The caption is rendered HERE as well, not left to the branches below. It used to
         live only inside the placeholder (which this replaces) and the with-image
         figcaption, so a loading frame showed a bare gradient and the "adding the photo…"
         copy was unreachable on every surface that passed it — the string was dead.

         aria-live + aria-busy because a spinner alone says nothing to a screen reader: it
         would be indistinguishable from an ordinary empty frame. -->
    <div
      v-if="showLoading"
      class="relative grid w-full place-items-center overflow-hidden"
      role="status"
      aria-live="polite"
      aria-busy="true"
      :style="{
        aspectRatio: aspectRatio ?? '4 / 3',
        background: 'linear-gradient(135deg, #f9e4c8 0%, #f5c99a 100%)',
      }"
    >
      <BeanieSpinner size="md" />
      <span
        v-if="caption"
        class="font-caveat absolute bottom-3.5 left-3.5 z-10 text-lg text-[#E67E22] opacity-75"
      >
        {{ caption }}
      </span>
    </div>
    <img
      v-else-if="src && !failed"
      :key="attempt"
      :src="src"
      :alt="alt ?? ''"
      class="block w-full bg-cover bg-center"
      :style="{ aspectRatio: aspectRatio ?? '4 / 3' }"
      referrerpolicy="no-referrer"
      @error="onImageError"
    />
    <div
      v-else
      class="relative grid w-full place-items-center overflow-hidden"
      :style="{
        aspectRatio: aspectRatio ?? '4 / 3',
        background: 'linear-gradient(135deg, #f9e4c8 0%, #f5c99a 100%)',
      }"
    >
      <!-- Faint gingham pattern -->
      <div
        class="absolute inset-0"
        style="
          background-image:
            linear-gradient(rgb(230 126 34 / 8%) 1px, transparent 1px),
            linear-gradient(90deg, rgb(230 126 34 / 8%) 1px, transparent 1px);
          background-size: 16px 16px;
        "
        aria-hidden="true"
      />
      <svg
        class="relative z-10 h-20 w-20"
        :style="{ color: tint }"
        viewBox="0 0 64 64"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          v-for="(p, i) in glyph.paths"
          :key="i"
          :d="p.d"
          :stroke-width="p.strokeWidth"
          :stroke-dasharray="p.dashArray"
        />
      </svg>
      <span
        v-if="caption"
        class="font-caveat absolute bottom-3.5 left-3.5 z-10 text-lg text-[#E67E22] opacity-75"
      >
        {{ caption }}
      </span>
    </div>
    <figcaption
      v-if="caption && src && !failed && !showLoading"
      class="font-caveat text-secondary-500 absolute right-0 bottom-1 left-0 text-center text-base"
    >
      {{ caption }}
    </figcaption>
  </figure>
</template>
