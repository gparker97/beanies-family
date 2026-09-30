<script setup lang="ts">
/**
 * The house magic beans card button (#116): the Heritage Orange → Terracotta gradient,
 * the shared `.magic-shimmer` sheen, the orange shadow, and nothing else. A SHELL: each
 * card lays out its own content in the default slot (the add drawers' quick card is a
 * column, the week shopping list's Find Duplicates card is a row) and passes its padding
 * as a class. The slot sits in a `relative z-[1]` wrapper, so the sheen (an absolutely
 * positioned `::after`) passes BEHIND the words, never over them. The button is a flex
 * column so, stretched by a grid row (the activity drawer's two-up Quick start), its
 * content stays at the top instead of a button's default vertical centring.
 *
 * `busy`: the sheen speeds up (`.magic-shimmer-busy`), `aria-busy` + `aria-disabled` are
 * set and clicks are swallowed. Deliberately NOT `disabled`, which would drop focus from
 * the button the user just pressed. Reduced motion is honoured by the shared CSS.
 *
 * White on the gradient in both modes: a filled button, so no `-lift` partner (CIG).
 */
const props = defineProps<{ busy?: boolean }>();

const emit = defineEmits<{ click: [event: MouseEvent] }>();

function onClick(e: MouseEvent): void {
  if (props.busy) return;
  emit('click', e);
}
</script>

<template>
  <button
    type="button"
    class="magic-shimmer from-primary-500 to-terracotta-400 flex w-full flex-col rounded-2xl bg-gradient-to-br text-left text-white shadow-[0_8px_18px_-8px_rgba(241,93,34,0.6)]"
    :class="busy ? 'magic-shimmer-busy cursor-progress' : 'cursor-pointer'"
    :aria-busy="busy ? 'true' : undefined"
    :aria-disabled="busy ? 'true' : undefined"
    data-testid="magic-beans-card-button"
    @click="onClick"
  >
    <span class="relative z-[1]"><slot /></span>
  </button>
</template>
