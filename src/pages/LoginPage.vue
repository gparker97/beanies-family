<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { isCognitoConfigured } from '@/config/cognito';
import * as cognitoService from '@/services/auth/cognitoService';
import { isWebAuthnSupported } from '@/services/auth/passkeyService';
import { useAuthStore } from '@/stores/authStore';

const authStore = useAuthStore();

const activeTab = ref<'signin' | 'signup'>('signin');
const showMagicLink = ref(false);
const magicLinkSent = ref(false);
const webAuthnAvailable = ref(false);

// Sign In form
const signInEmail = ref('');
const signInPassword = ref('');

// Magic link form
const magicLinkEmail = ref('');

// Sign Up form
const signUpFamilyName = ref('');
const signUpName = ref('');
const signUpEmail = ref('');
const signUpPassword = ref('');
const signUpConfirmPassword = ref('');

const formError = ref<string | null>(null);
const successMessage = ref<string | null>(null);

onMounted(() => {
  webAuthnAvailable.value = isWebAuthnSupported();
});

async function handleSignIn() {
  formError.value = null;

  if (!signInEmail.value || !signInPassword.value) {
    formError.value = 'Please enter your email and password';
    return;
  }

  const result = await authStore.signIn(signInEmail.value, signInPassword.value);
  if (result.success) {
    // Full page reload to ensure App.vue's onMounted runs fresh
    // and loads the correct family's data from IndexedDB
    window.location.href = '/dashboard';
  } else {
    formError.value = result.error ?? 'Sign in failed';
  }
}

async function handleSignUp() {
  formError.value = null;

  if (!signUpFamilyName.value || !signUpName.value || !signUpEmail.value || !signUpPassword.value) {
    formError.value = 'Please fill in all fields';
    return;
  }

  if (signUpPassword.value !== signUpConfirmPassword.value) {
    formError.value = 'Passwords do not match';
    return;
  }

  if (signUpPassword.value.length < 8) {
    formError.value = 'Password must be at least 8 characters';
    return;
  }

  const result = await authStore.signUp({
    email: signUpEmail.value,
    password: signUpPassword.value,
    familyName: signUpFamilyName.value,
    memberName: signUpName.value,
  });

  if (result.needsVerification) {
    successMessage.value =
      'Account created! We sent a verification link to ' +
      signUpEmail.value +
      '. Please click the link in the email to verify your account before signing in.';
    activeTab.value = 'signin';
    signInEmail.value = signUpEmail.value;
    return;
  }

  if (result.success) {
    window.location.href = '/dashboard';
  } else {
    formError.value = result.error ?? 'Sign up failed';
  }
}

async function handleMagicLink() {
  formError.value = null;

  if (!magicLinkEmail.value) {
    formError.value = 'Please enter your email';
    return;
  }

  if (!isCognitoConfigured()) {
    formError.value = 'Authentication is not configured';
    return;
  }

  try {
    const result = await cognitoService.initiateCustomAuth(magicLinkEmail.value);
    if (result.challengeName === 'CUSTOM_CHALLENGE') {
      magicLinkSent.value = true;
    } else if (result.error) {
      formError.value = result.error;
    } else {
      formError.value = 'Unable to send magic link. Please try signing in with a password.';
    }
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to send magic link';
  }
}

function handlePasskeySignIn() {
  formError.value =
    'Passkey sign-in requires server-side infrastructure (AWS Cognito WebAuthn challenge). ' +
    'This will be available once the backend is deployed.';
}

async function handleContinueWithoutAuth() {
  await authStore.continueWithoutAuth();
  window.location.href = '/dashboard';
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <h1 class="font-outfit text-secondary-500 text-3xl font-bold dark:text-gray-100">
          beanies.family
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">Every bean counts</p>

        <!-- Security benefits -->
        <div class="mt-6 space-y-3 text-left">
          <div class="flex items-start gap-3">
            <svg
              class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Your data is encrypted and stored in a file you control
            </p>
          </div>
          <div class="flex items-start gap-3">
            <svg
              class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              No data is stored on our servers — everything stays on your device
            </p>
          </div>
          <div class="flex items-start gap-3">
            <svg
              class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              Back up easily by saving your data file to Google Drive, Dropbox, or any cloud folder
            </p>
          </div>
        </div>
      </div>

      <BaseCard>
        <!-- Tab switcher -->
        <div class="mb-6 flex border-b border-gray-200 dark:border-slate-700">
          <button
            :class="[
              'flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'signin'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
            ]"
            @click="
              activeTab = 'signin';
              showMagicLink = false;
              magicLinkSent = false;
              formError = null;
            "
          >
            Sign In
          </button>
          <button
            :class="[
              'flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'signup'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
            ]"
            @click="
              activeTab = 'signup';
              showMagicLink = false;
              magicLinkSent = false;
              formError = null;
            "
          >
            Create Account
          </button>
        </div>

        <!-- Error/Success messages -->
        <div
          v-if="formError"
          class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ formError }}
        </div>
        <div
          v-if="successMessage"
          class="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
        >
          {{ successMessage }}
        </div>

        <!-- Sign In Form -->
        <div v-if="activeTab === 'signin'">
          <!-- Magic link sent confirmation -->
          <div v-if="magicLinkSent" class="py-6 text-center">
            <svg
              class="text-primary-500 mx-auto mb-4 h-12 w-12"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <p class="font-medium text-gray-900 dark:text-gray-100">Check your email</p>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              We sent a magic link to <strong>{{ magicLinkEmail }}</strong
              >. Click the link to sign in.
            </p>
            <button
              class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mt-4 text-sm"
              @click="
                magicLinkSent = false;
                showMagicLink = false;
              "
            >
              Back to sign in
            </button>
          </div>

          <!-- Magic link form -->
          <form v-else-if="showMagicLink" @submit.prevent="handleMagicLink">
            <div class="space-y-4">
              <BaseInput
                v-model="magicLinkEmail"
                label="Email"
                type="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
              {{ authStore.isLoading ? 'Sending...' : 'Send Magic Link' }}
            </BaseButton>

            <button
              type="button"
              class="mt-3 w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              @click="showMagicLink = false"
            >
              Sign in with password instead
            </button>
          </form>

          <!-- Standard sign in form -->
          <form v-else @submit.prevent="handleSignIn">
            <div class="space-y-4">
              <BaseInput
                v-model="signInEmail"
                label="Email"
                type="email"
                placeholder="you@example.com"
                required
              />
              <BaseInput
                v-model="signInPassword"
                label="Password"
                type="password"
                placeholder="Enter your password"
                required
              />
            </div>

            <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
              {{ authStore.isLoading ? 'Signing in...' : 'Sign In' }}
            </BaseButton>

            <!-- Alternative sign-in methods -->
            <div class="mt-4 space-y-2">
              <button
                type="button"
                class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 w-full text-center text-sm"
                @click="
                  showMagicLink = true;
                  formError = null;
                "
              >
                Sign in with magic link
              </button>

              <button
                v-if="webAuthnAvailable"
                type="button"
                class="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
                @click="handlePasskeySignIn"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
                  />
                </svg>
                Sign in with passkey
              </button>
            </div>
          </form>
        </div>

        <!-- Sign Up Form -->
        <form v-if="activeTab === 'signup'" @submit.prevent="handleSignUp">
          <div class="space-y-4">
            <BaseInput
              v-model="signUpFamilyName"
              label="Family Name"
              placeholder="The Smith Family"
              required
            />
            <BaseInput v-model="signUpName" label="Your Name" placeholder="John Smith" required />
            <BaseInput
              v-model="signUpEmail"
              label="Email"
              type="email"
              placeholder="you@example.com"
              required
            />
            <BaseInput
              v-model="signUpPassword"
              label="Password"
              type="password"
              placeholder="At least 8 characters"
              required
            />
            <BaseInput
              v-model="signUpConfirmPassword"
              label="Confirm Password"
              type="password"
              placeholder="Re-enter your password"
              required
            />
          </div>

          <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
            {{ authStore.isLoading ? 'Creating account...' : 'Create Account' }}
          </BaseButton>
        </form>

        <!-- Continue without account -->
        <div class="mt-6 border-t border-gray-200 pt-4 dark:border-slate-700">
          <button
            class="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            @click="handleContinueWithoutAuth"
          >
            Continue without an account
          </button>
        </div>
      </BaseCard>
    </div>
  </div>
</template>
