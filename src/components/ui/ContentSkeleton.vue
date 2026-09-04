<script setup lang="ts">
/**
 * ContentSkeleton — generic content area skeleton shown during cache-first loading.
 *
 * Mimics the Nook page card layout with warm Heritage Orange shimmer animation.
 * Matches the canonical card pattern used across the app (rounded-[var(--sq)],
 * bg-white dark:bg-surface-raised, var(--card-shadow)). Works for any page — shows
 * a familiar card-grid placeholder while data loads.
 */
</script>

<template>
  <div class="space-y-6">
    <!-- Greeting area skeleton -->
    <div class="space-y-2 px-1">
      <div class="animate-beanie-shimmer dark:bg-surface-overlay h-7 w-48 rounded-lg bg-gray-100" />
      <div
        class="animate-beanie-shimmer dark:bg-surface-overlay h-4 w-32 rounded-md bg-gray-100"
        style="animation-delay: 0.1s"
      />
    </div>

    <!-- Bean avatars row skeleton -->
    <div class="flex gap-3 px-1">
      <div
        v-for="i in 4"
        :key="i"
        class="animate-beanie-shimmer dark:bg-surface-overlay h-10 w-10 rounded-full bg-gray-100"
        :style="{ animationDelay: `${i * 0.08}s` }"
      />
    </div>

    <!-- Two side-by-side cards (mimics Schedule Cards) -->
    <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
      <div
        v-for="i in 2"
        :key="`schedule-${i}`"
        class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)]"
        :style="{ animationDelay: `${i * 0.15}s` }"
      >
        <!-- Card title bar -->
        <div
          class="animate-beanie-shimmer dark:bg-surface-overlay mb-4 h-3 w-24 rounded bg-gray-100"
        />
        <!-- Content lines -->
        <div class="space-y-3">
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-10 w-full rounded-xl bg-gray-100"
            :style="{ animationDelay: `${i * 0.15 + 0.1}s` }"
          />
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-10 w-full rounded-xl bg-gray-100"
            :style="{ animationDelay: `${i * 0.15 + 0.2}s` }"
          />
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-10 w-3/4 rounded-xl bg-gray-100"
            :style="{ animationDelay: `${i * 0.15 + 0.3}s` }"
          />
        </div>
      </div>
    </div>

    <!-- Full-width card (mimics Todo Widget) -->
    <div
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)]"
    >
      <div
        class="animate-beanie-shimmer dark:bg-surface-overlay mb-4 h-3 w-20 rounded bg-gray-100"
      />
      <div class="space-y-3">
        <div v-for="i in 4" :key="`todo-${i}`" class="flex items-center gap-3">
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-5 w-5 shrink-0 rounded bg-gray-100"
            :style="{ animationDelay: `${0.4 + i * 0.08}s` }"
          />
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-4 rounded bg-gray-100"
            :style="{ width: `${70 - i * 10}%`, animationDelay: `${0.4 + i * 0.08}s` }"
          />
        </div>
      </div>
    </div>

    <!-- Two-column grid (mimics Milestones + Piggy Bank) -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div
        v-for="i in 2"
        :key="`bottom-${i}`"
        class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)]"
      >
        <div
          class="animate-beanie-shimmer dark:bg-surface-overlay mb-4 h-3 w-28 rounded bg-gray-100"
          :style="{ animationDelay: `${0.6 + i * 0.15}s` }"
        />
        <div class="space-y-3">
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-8 w-full rounded-xl bg-gray-100"
            :style="{ animationDelay: `${0.6 + i * 0.15 + 0.1}s` }"
          />
          <div
            class="animate-beanie-shimmer dark:bg-surface-overlay h-8 w-5/6 rounded-xl bg-gray-100"
            :style="{ animationDelay: `${0.6 + i * 0.15 + 0.2}s` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
