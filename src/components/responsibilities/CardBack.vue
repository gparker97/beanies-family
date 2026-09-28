<script setup lang="ts">
/**
 * Who Owns What (#109): the back of a deck card, Heritage Orange into Terracotta with the
 * beanies logo (a parent and child holding hands). The ONE definition, used behind the deal
 * pile's live card and, small and fanned, as the Card Details drawer's header icon.
 *
 * Decorative; the caller positions it (absolute inset, rotation) through its own class.
 */
withDefaults(defineProps<{ small?: boolean }>(), { small: false });
</script>

<template>
  <div class="card-back" :class="{ 'is-small': small }" aria-hidden="true">
    <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" draggable="false" />
  </div>
</template>

<style scoped>
.card-back {
  background: linear-gradient(155deg, #f15d22, #e67e22);
  border: 4px solid #fff;
  border-radius: 1rem;
  box-shadow: var(--card-shadow);
  display: grid;
  place-items: center;
}

.card-back.is-small {
  border-radius: 0.3125rem;
  border-width: 1.5px;
  box-shadow: 0 1px 3px rgb(44 62 80 / 25%);
}

html.dark .card-back {
  border-color: var(--color-surface-raised);
}

.card-back img {
  opacity: 0.9;
  width: 35%;
}

.card-back.is-small img {
  opacity: 1;
  width: 70%;
}
</style>
