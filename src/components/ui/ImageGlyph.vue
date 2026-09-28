<script setup lang="ts">
/**
 * An image-or-emoji glyph: the image when `src` is given, otherwise the emoji. The
 * emoji is always required because it doubles as the fallback if the image fails to
 * load: never a broken-image box, and never silent (the failure goes to the diagnostic
 * firehose under `surface`, and to the console with the fix).
 *
 * `src` is a static bundled asset path (brand art such as The Bean Pod's nav anchor or a
 * Who Owns What hero card), never a user photo: a failure sticks for the session and the
 * file name ships as the log's `kind`. User photos have their own components
 * (`BeanieAvatar`, `MealThumb`).
 *
 * Sizing: `imgClass` sizes the image; the caller's `class` falls through to whichever
 * element renders, so a `text-*` class sizes the emoji and a grey-out class
 * (`grayscale opacity-55`) reaches either. The caller's own element owns any box
 * (background, radius, fixed size); never pass box classes here.
 *
 * Decorative: the surrounding control carries the accessible name.
 */
import { computed } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

const props = withDefaults(
  defineProps<{ emoji: string; src?: string; surface: string; imgClass?: string }>(),
  { src: undefined, imgClass: 'h-6 w-6' }
);

const showImg = computed(() => !!props.src && !failedSrcs.has(props.src));

function onError() {
  const src = props.src;
  // Two glyphs with the same src can both fire `error` before either re-renders.
  if (!src || failedSrcs.has(src)) return;
  failedSrcs.add(src);
  // Only a bundled /brand/ file name is declared as `kind`; anything else ships a fixed label.
  const file = src.startsWith('/brand/') ? (src.split('/').pop() ?? src) : 'non-brand-src';
  logEvent({
    level: 'warn',
    surface: props.surface,
    message: 'image failed to load; emoji fallback shown',
    context: { kind: file },
  });
  console.warn(
    `[ImageGlyph] ${src} failed to load; showing the emoji. Brand art: check packages/brand/assets/shared/${src.replace(/^\/brand\//, '')} exists, then npm run sync-brand-assets.`
  );
}
</script>

<script lang="ts">
import { reactive } from 'vue';

// Module scope, not `<script setup>` (which runs per instance): ONE record per session,
// so a missing file is requested and logged once, and every glyph showing it falls back
// together.
const failedSrcs = reactive(new Set<string>());
</script>

<template>
  <img
    v-if="showImg"
    :src="src"
    alt=""
    aria-hidden="true"
    draggable="false"
    class="inline-block object-contain"
    :class="imgClass"
    @error="onError"
  />
  <span v-else aria-hidden="true">{{ emoji }}</span>
</template>
