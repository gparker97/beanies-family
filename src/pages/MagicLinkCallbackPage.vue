<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseCard from '@/components/ui/BaseCard.vue';
import { isCognitoConfigured } from '@/config/cognito';
import * as cognitoService from '@/services/auth/cognitoService';
import * as tokenManager from '@/services/auth/tokenManager';
import { useAuthStore } from '@/stores/authStore';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const status = ref<'verifying' | 'success' | 'error'>('verifying');
const errorMessage = ref('');

onMounted(async () => {
  const code = route.query.code as string | undefined;
  const email = route.query.email as string | undefined;

  if (!code || !email) {
    status.value = 'error';
    errorMessage.value = 'Invalid magic link. Please request a new one.';
    return;
  }

  if (!isCognitoConfigured()) {
    status.value = 'error';
    errorMessage.value = 'Authentication is not configured.';
    return;
  }

  try {
    // Step 1: Initiate custom auth to get the CognitoUser with challenge
    const initResult = await cognitoService.initiateCustomAuth(email);

    if (initResult.success && initResult.session) {
      // Already authenticated (shouldn't happen for magic link, but handle it)
      await handleSuccessfulAuth(initResult.session);
      return;
    }

    if (initResult.challengeName !== 'CUSTOM_CHALLENGE' || !initResult.cognitoUser) {
      status.value = 'error';
      errorMessage.value = initResult.error || 'Unexpected authentication state.';
      return;
    }

    // Step 2: Respond with the magic link code
    const challengeResult = await cognitoService.respondToMagicLinkChallenge(
      initResult.cognitoUser,
      code
    );

    if (challengeResult.success && challengeResult.session) {
      await handleSuccessfulAuth(challengeResult.session);
    } else {
      status.value = 'error';
      errorMessage.value = challengeResult.error || 'Invalid or expired magic link code.';
    }
  } catch (err) {
    status.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : 'An unexpected error occurred.';
  }
});

async function handleSuccessfulAuth(
  session: import('amazon-cognito-identity-js').CognitoUserSession
) {
  // Cache tokens for offline access
  const claims = cognitoService.getIdTokenClaims(session);
  await tokenManager.cacheSession({
    userId: claims.sub,
    email: claims.email,
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: new Date(claims.exp * 1000),
    familyId: claims.familyId ?? '',
  });

  status.value = 'success';

  // Re-initialize auth state and redirect
  await authStore.initializeAuth();
  router.replace('/dashboard');
}

function goToLogin() {
  router.replace('/login');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
    <BaseCard class="w-full max-w-md text-center">
      <div v-if="status === 'verifying'" class="py-8">
        <div
          class="border-sky-silk-100 border-t-primary-500 mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4"
        ></div>
        <p class="text-gray-600 dark:text-gray-400">Verifying your magic link...</p>
      </div>

      <div v-if="status === 'success'" class="py-8">
        <svg
          class="mx-auto mb-4 h-12 w-12 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
        <p class="text-gray-600 dark:text-gray-400">Signed in successfully! Redirecting...</p>
      </div>

      <div v-if="status === 'error'" class="py-8">
        <p class="mb-4 text-red-600 dark:text-red-400">{{ errorMessage }}</p>
        <button
          class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 text-sm"
          @click="goToLogin"
        >
          Back to login
        </button>
      </div>
    </BaseCard>
  </div>
</template>
