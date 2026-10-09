<script setup lang="ts">
/**
 * A friendly line in the handwritten Caveat face, with any number in it kept in bold Outfit.
 *
 * The CIG keeps figures out of Caveat because its numerals are hard to read at a glance, but
 * a sentence like "3 things on today" is the kind of warm accent Caveat is for. Splitting the
 * template keeps both: the words are handwritten, the number stays legible. Pass the `t()`
 * template and its values exactly as you would to `fillTemplate`; colour and size come from
 * the parent's class.
 */
import { computed } from 'vue';
import { splitTemplate } from '@/utils/fillTemplate';

const props = withDefaults(
  defineProps<{
    template: string;
    values: Record<string, string | number>;
    tag?: 'span' | 'p';
  }>(),
  { tag: 'span' }
);

const parts = computed(() => splitTemplate(props.template, props.values));
</script>

<template>
  <component :is="tag" class="font-caveat font-bold">
    <template v-for="(part, i) in parts" :key="i">
      <span v-if="part.value" class="font-outfit handwritten-figure font-extrabold">{{
        part.text
      }}</span>
      <template v-else>{{ part.text }}</template>
    </template>
  </component>
</template>

<style scoped>
/* Outfit sits taller than Caveat at the same size; this lines the figure up with the words. */
.handwritten-figure {
  font-size: 0.8em;
}
</style>
