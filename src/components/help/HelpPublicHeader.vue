<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <header
    class="flex items-center justify-between border-b border-gray-100 bg-white px-6 py-3 dark:border-slate-700 dark:bg-slate-800"
  >
    <router-link to="/help" class="flex items-center gap-2">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt="beanies.family"
        class="h-8 w-8"
      />
      <span class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
        beanies.family
      </span>
    </router-link>
    <button
      class="bg-primary-500 hover:bg-primary-600 rounded-2xl px-4 py-2 text-sm font-medium text-white transition-colors"
      @click="router.push('/login')"
    >
      Sign In
    </button>
  </header>
</template>
