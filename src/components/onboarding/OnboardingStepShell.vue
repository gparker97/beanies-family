<script setup lang="ts">
/**
 * Wraps every data-entry step in the onboarding wizard. Owns the shared
 * brand background (cloud-white-to-tinted gradient + ambient corner blobs)
 * and imports the `.ob-*` utility classes that step bodies use.
 *
 * Usage:
 *   <OnboardingStepShell>
 *     <template #decorations>
 *       <div class="ob-float-emoji" style="top:40px;left:40px;font-size:24px">💰</div>
 *       <!-- ... -->
 *     </template>
 *     <!-- step content -->
 *   </OnboardingStepShell>
 *
 * The decorations slot positions floating emojis per-step. The default slot
 * is the step's actual form content. Children apply `.ob-*` class names
 * directly — no `:deep()` plumbing needed.
 */
</script>

<template>
  <div class="ob-form">
    <slot name="decorations" />
    <slot />
  </div>
</template>

<style src="./onboarding-shared.css"></style>
