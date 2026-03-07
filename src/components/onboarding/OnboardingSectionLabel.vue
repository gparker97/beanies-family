<script setup lang="ts">
defineProps<{
  letter: string;
  label: string;
  subtitle?: string;
  color: string;
  badgeGradient: string;
}>();
</script>

<template>
  <div class="ob-section-label" :style="{ color }">
    <div class="ob-section-badge" :style="{ background: badgeGradient }">
      {{ letter }}
    </div>
    <span class="ob-section-text">{{ label }}</span>
    <span v-if="subtitle" class="ob-section-subtitle">{{ subtitle }}</span>
  </div>
</template>

<style scoped>
.ob-section-label {
  align-items: center;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  gap: 8px;
  letter-spacing: 0.12em;
  margin-bottom: 10px;
  text-transform: uppercase;
}

.ob-section-badge {
  align-items: center;
  border-radius: 50%;
  color: white;
  display: flex;
  flex-shrink: 0;
  font-size: 0.55rem;
  font-weight: 800;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.ob-section-text {
  white-space: nowrap;
}

.ob-section-subtitle {
  font-size: 0.55rem;
  font-weight: 400;
  letter-spacing: 0;
  opacity: 0.5;
  text-transform: none;
  white-space: nowrap;
}
</style>
