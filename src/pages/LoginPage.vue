<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { isCognitoConfigured } from '@/config/cognito';
import * as cognitoService from '@/services/auth/cognitoService';
import { isWebAuthnSupported } from '@/services/auth/passkeyService';
import { useAuthStore } from '@/stores/authStore';

const { t } = useTranslation();
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

// Verification code form (shown after signup)
const pendingVerificationEmail = ref('');
const pendingVerificationPassword = ref('');
const verificationCode = ref('');
const isVerifying = ref(false);
const showVerification = ref(false);

const formError = ref<string | null>(null);
const successMessage = ref<string | null>(null);

onMounted(() => {
  webAuthnAvailable.value = isWebAuthnSupported();
});

async function handleSignIn() {
  formError.value = null;

  if (!signInEmail.value || !signInPassword.value) {
    formError.value = t('auth.enterEmailPassword');
    return;
  }

  const result = await authStore.signIn(signInEmail.value, signInPassword.value);
  if (result.success) {
    // Full page reload to ensure App.vue's onMounted runs fresh.
    // Check onboarding status directly from DB to determine destination.
    let destination = '/dashboard';
    try {
      const { getSettings } = await import('@/services/indexeddb/repositories/settingsRepository');
      const settings = await getSettings();
      if (!settings.onboardingCompleted) {
        destination = '/setup';
      }
    } catch {
      // If settings can't be loaded, default to dashboard and let App.vue handle it
    }
    window.location.href = destination;
  } else {
    formError.value = result.error ?? 'Sign in failed';
  }
}

async function handleSignUp() {
  formError.value = null;

  if (!signUpFamilyName.value || !signUpName.value || !signUpEmail.value || !signUpPassword.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  if (signUpPassword.value !== signUpConfirmPassword.value) {
    formError.value = t('auth.passwordsDoNotMatch');
    return;
  }

  if (signUpPassword.value.length < 8) {
    formError.value = t('auth.passwordMinLength');
    return;
  }

  const result = await authStore.signUp({
    email: signUpEmail.value,
    password: signUpPassword.value,
    familyName: signUpFamilyName.value,
    memberName: signUpName.value,
  });

  if (result.needsVerification) {
    // Show the code verification form instead of switching to sign-in
    pendingVerificationEmail.value = signUpEmail.value;
    pendingVerificationPassword.value = signUpPassword.value;
    showVerification.value = true;
    formError.value = null;
    successMessage.value = null;
    return;
  }

  if (result.success) {
    // New user — go to setup wizard
    window.location.href = '/setup';
  } else {
    formError.value = result.error ?? 'Sign up failed';
  }
}

async function handleVerifyCode() {
  formError.value = null;
  successMessage.value = null;
  isVerifying.value = true;

  try {
    // Confirm the signup with the verification code
    await cognitoService.confirmSignUp(
      pendingVerificationEmail.value,
      verificationCode.value.trim()
    );

    // Auto sign-in after successful verification
    const result = await authStore.signIn(
      pendingVerificationEmail.value,
      pendingVerificationPassword.value
    );

    if (result.success) {
      // New user — always go to setup wizard
      window.location.href = '/setup';
    } else {
      // Verification succeeded but sign-in failed — switch to sign-in form
      formError.value = result.error ?? 'Sign in failed after verification';
      signInEmail.value = pendingVerificationEmail.value;
      showVerification.value = false;
      activeTab.value = 'signin';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    formError.value = message.includes('ExpiredCodeException')
      ? t('auth.invalidCode')
      : t('auth.invalidCode');
  } finally {
    isVerifying.value = false;
  }
}

async function handleResendCode() {
  formError.value = null;
  try {
    await cognitoService.resendConfirmationCode(pendingVerificationEmail.value);
    successMessage.value = t('auth.codeSent');
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to resend code';
  }
}

async function handleMagicLink() {
  formError.value = null;

  if (!magicLinkEmail.value) {
    formError.value = 'Please enter your email';
    return;
  }

  if (!isCognitoConfigured()) {
    formError.value = t('auth.notConfigured');
    return;
  }

  try {
    const result = await cognitoService.initiateCustomAuth(magicLinkEmail.value);
    if (result.challengeName === 'CUSTOM_CHALLENGE') {
      magicLinkSent.value = true;
    } else if (result.error) {
      formError.value = result.error;
    } else {
      formError.value = t('auth.magicLinkFailed');
    }
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Failed to send magic link';
  }
}

function handlePasskeySignIn() {
  formError.value = t('auth.passkeyNotAvailable');
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
        <img
          src="/brand/beanies_celebrating_line_transparent_600x600.png"
          alt="beanies celebrating"
          class="mx-auto -mb-[7.5rem] w-full max-w-sm"
        />
        <h1 class="font-outfit text-5xl font-bold">
          <span class="text-secondary-500 dark:text-gray-100">beanies</span
          ><span class="text-primary-500">.family</span>
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">every bean counts</p>
      </div>

      <BaseCard>
        <!-- Verification code form (shown after signup) -->
        <div v-if="showVerification">
          <div class="py-2 text-center">
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
            <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('auth.checkEmail') }}</p>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {{ t('auth.enterVerificationCode') }}
              <strong>{{ pendingVerificationEmail }}</strong>
            </p>
          </div>

          <!-- Error/Success messages -->
          <div
            v-if="formError"
            class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          >
            {{ formError }}
          </div>
          <div
            v-if="successMessage"
            class="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
          >
            {{ successMessage }}
          </div>

          <form class="mt-4" @submit.prevent="handleVerifyCode">
            <BaseInput
              v-model="verificationCode"
              :label="t('auth.verificationCode')"
              placeholder="123456"
              required
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
            />

            <BaseButton type="submit" class="mt-6 w-full" :disabled="isVerifying">
              {{ isVerifying ? t('auth.verifying') : t('auth.verify') }}
            </BaseButton>
          </form>

          <button
            type="button"
            class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mt-4 w-full text-center text-sm"
            @click="handleResendCode"
          >
            {{ t('auth.resendCode') }}
          </button>
        </div>

        <!-- Normal login/signup flow -->
        <template v-else>
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
              {{ t('auth.signIn') }}
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
              {{ t('auth.createAccount') }}
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
              <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('auth.checkEmail') }}</p>
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {{ t('auth.magicLinkSentTo') }} <strong>{{ magicLinkEmail }}</strong
                >. {{ t('auth.magicLinkAction') }}
              </p>
              <button
                class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mt-4 text-sm"
                @click="
                  magicLinkSent = false;
                  showMagicLink = false;
                "
              >
                {{ t('auth.backToSignIn') }}
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
                {{ authStore.isLoading ? t('auth.sendingMagicLink') : t('auth.sendMagicLink') }}
              </BaseButton>

              <button
                type="button"
                class="mt-3 w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                @click="showMagicLink = false"
              >
                {{ t('auth.signInPassword') }}
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
                {{ authStore.isLoading ? t('auth.signingIn') : t('auth.signIn') }}
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
                  {{ t('auth.signInMagicLink') }}
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
                  {{ t('auth.signInPasskey') }}
                </button>
              </div>
            </form>
          </div>

          <!-- Sign Up Form -->
          <form v-if="activeTab === 'signup'" @submit.prevent="handleSignUp">
            <div class="space-y-4">
              <BaseInput
                v-model="signUpFamilyName"
                :label="t('auth.familyName')"
                :placeholder="t('auth.familyNamePlaceholder')"
                required
              />
              <BaseInput
                v-model="signUpName"
                :label="t('setup.yourName')"
                :placeholder="t('auth.yourNamePlaceholder')"
                required
              />
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
                :placeholder="t('auth.passwordPlaceholder')"
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
              {{ authStore.isLoading ? t('auth.creatingAccount') : t('auth.createAccount') }}
            </BaseButton>
          </form>

          <!-- Continue without account (local dev only — hidden when Cognito is configured) -->
          <div
            v-if="!isCognitoConfigured()"
            class="mt-6 border-t border-gray-200 pt-4 dark:border-slate-700"
          >
            <button
              class="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              @click="handleContinueWithoutAuth"
            >
              {{ t('auth.continueWithoutAccount') }}
            </button>
          </div>
        </template>
      </BaseCard>

      <!-- Security benefits -->
      <div class="mt-6 space-y-3">
        <div class="flex items-start gap-3">
          <img
            src="/brand/beanies_impact_bullet_transparent_192x192.png"
            alt=""
            class="mt-0.5 h-5 w-5 flex-shrink-0"
          />
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.securityEncrypted') }}
          </p>
        </div>
        <div class="flex items-start gap-3">
          <img
            src="/brand/beanies_impact_bullet_transparent_192x192.png"
            alt=""
            class="mt-0.5 h-5 w-5 flex-shrink-0"
          />
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.securityNoServers') }}
          </p>
        </div>
        <div class="flex items-start gap-3">
          <img
            src="/brand/beanies_impact_bullet_transparent_192x192.png"
            alt=""
            class="mt-0.5 h-5 w-5 flex-shrink-0"
          />
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.securityBackup') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
