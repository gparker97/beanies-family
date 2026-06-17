<script setup lang="ts">
// CIG convention (#33): a warm, handwritten "page welcome subtitle" — one per
// warm Treehouse page, Heritage-Orange Caveat, accent only (never a real
// label/header). The parent resolves the copy via t() and passes it in.
defineProps<{ text: string }>();
</script>

<template>
  <p class="welcome-subtitle text-xl text-[var(--color-primary-500)]">{{ text }}</p>
</template>

<style scoped>
.welcome-subtitle {
  font-family: Caveat, cursive;
  line-height: 1.2;
}
</style>
