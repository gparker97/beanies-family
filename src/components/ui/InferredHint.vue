<script setup lang="ts">
/**
 * "beanies filled this in — worth a look."
 *
 * ⚠️ HERITAGE ORANGE, NEVER ALERT RED. This is a routine worth-a-look, not an error; red is
 * reserved for destructive confirmations and hard validation failures. Same idiom as
 * `ActivityModal`'s low-confidence hint.
 *
 * It is a named component rather than a `hint` prop on `FormFieldGroup` deliberately. An
 * optional prop would cost that primitive's ~45 call sites nothing today, but it would bake
 * a feature-specific ATTENTION colour into the app's generic label/control primitive, where
 * the next caller will reasonably read `hint` as neutral helper text and be handed Heritage
 * Orange. The idiom gets its own component; the primitive stays generic.
 *
 * Renders nothing when there is nothing to say, so callers need no `v-if` of their own.
 */
defineProps<{
  /** The hint text. Falsy → nothing renders. */
  text?: string;
}>();
</script>

<template>
  <p
    v-if="text"
    data-testid="inferred-hint"
    class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs"
  >
    {{ text }}
  </p>
</template>
