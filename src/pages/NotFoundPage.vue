<script setup lang="ts">
import { useRouter } from 'vue-router';
import { BaseButton } from '@/components/ui';

const router = useRouter();

function goHome() {
  router.push('/dashboard');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
    <div class="text-center">
      <h1 class="text-9xl font-bold text-gray-200 dark:text-slate-700">404</h1>
      <h2 class="mt-4 text-2xl font-bold text-gray-900 dark:text-gray-100">Page Not Found</h2>
      <p class="mt-2 text-gray-500 dark:text-gray-400">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div class="mt-6">
        <BaseButton @click="goHome"> Back to Dashboard </BaseButton>
      </div>
    </div>
  </div>
</template>
