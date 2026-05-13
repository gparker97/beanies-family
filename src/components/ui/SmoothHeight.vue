<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

/**
 * Smoothly animates its own height when the wrapped content changes.
 *
 * Wrap a list whose item count expands/collapses (see `useExpandableList` /
 * `<ShowMoreToggle>` — ADR-025) so the container grows or shrinks with a
 * transition and the new items are revealed by the opening clip-window,
 * instead of the box snapping to full height. Bump `revision` whenever the
 * content should re-animate — e.g. `:revision="visible.length"`.
 *
 * Only deliberate `revision`-driven changes animate; ordinary reflows
 * (window resize, a row's text re-wrapping) leave `height: auto` and don't
 * jitter. `prefers-reduced-motion` skips the animation entirely.
 */
const props = defineProps<{ revision: unknown }>();

const el = ref<HTMLElement>();

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

watch(
  () => props.revision,
  async () => {
    const node = el.value;
    if (!node || REDUCED_MOTION) return;

    // `watch` (flush: 'pre') runs before the DOM update — capture the old height.
    const from = node.offsetHeight;
    await nextTick(); // new content is now rendered

    node.style.height = ''; // clear any in-flight pin so we measure the natural target
    const to = node.offsetHeight;
    if (from === to) return;

    node.style.height = `${from}px`;
    void node.offsetHeight; // force reflow so the browser registers `from`
    node.style.height = `${to}px`;

    let settled = false;
    const reset = () => {
      if (settled) return;
      settled = true;
      node.style.height = ''; // back to auto so later reflows aren't pinned
      node.removeEventListener('transitionend', onEnd);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === node && e.propertyName === 'height') reset();
    };
    node.addEventListener('transitionend', onEnd);
    setTimeout(reset, 450); // fallback if transitionend never fires (interrupted / no transition)
  }
);
</script>

<template>
  <div ref="el" class="smooth-height">
    <slot />
  </div>
</template>

<style scoped>
.smooth-height {
  overflow: hidden;

  /* Snappy ease-out — the box "swooshes open" then settles. */
  transition: height 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .smooth-height {
    transition: none;
  }
}
</style>
