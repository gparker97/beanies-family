<script setup lang="ts">
/**
 * The ONE prove screen (2026-08-28 login rethink) — renders `loginFlow`'s 'prove' state.
 * Replaces BiometricLoginView + PickBeanView's password form. Shows the picked person
 * and the ordered method chain the single decision engine resolved: biometric first
 * where a key exists, tap-through for credential-less members on an open pod, and the
 * password form as the always-available terminal. Pure renderer — every outcome emits
 * up to the flow driver; no store writes, no routing.
 */
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { fillTemplate } from '@/utils/fillTemplate';
import type { PersonCard } from '@/services/auth/loginFlow';
import type { ProveMethod } from '@/services/auth/proveMethods';

const props = defineProps<{
  familyName: string;
  person: PersonCard;
  methods: ProveMethod[];
  /** Error text owned by the flow driver (wrong password, mismatch, …). */
  error: string | null;
  isBusy: boolean;
  /** Whether the pod is already open — drives create-password vs bootstrap copy. */
  podOpen: boolean;
}>();

const emit = defineEmits<{
  biometric: [];
  'tap-through': [];
  password: [password: string];
  'create-password': [password: string];
  /** The user moved past an offered stronger method (telemetry). */
  'fell-back': [];
  back: [];
}>();

const { t } = useTranslation();

const password = ref('');
const confirmPassword = ref('');
const localError = ref<string | null>(null);
/** One telemetry ping per screen, however many times the field is poked. */
let fellBackOnce = false;

const hasBiometric = computed(() => props.methods.some((m) => m.kind === 'biometric'));
const hasTapThrough = computed(() => props.methods.some((m) => m.kind === 'tap-through'));
/**
 * Create-password mode: the member has no credential AND the pod is open (the doc must
 * be writable to store the hash). A credential-less member on a CLOSED pod cannot
 * bootstrap alone — the password form stays in normal mode and the family's usual
 * opener is the path in (matches today's deferred-password semantics).
 */
const isCreatingPassword = computed(() => props.person.hasCredential === false && props.podOpen);

const shownError = computed(() => localError.value ?? props.error);

function noteFallback() {
  if (fellBackOnce || (!hasBiometric.value && !hasTapThrough.value)) return;
  fellBackOnce = true;
  emit('fell-back');
}

function handleSubmit() {
  localError.value = null;
  if (!password.value) {
    localError.value = t('auth.enterPassword');
    return;
  }
  if (isCreatingPassword.value) {
    if (password.value.length < 8) {
      localError.value = t('auth.passwordMinLength');
      return;
    }
    if (password.value !== confirmPassword.value) {
      localError.value = t('auth.passwordsDoNotMatch');
      return;
    }
    emit('create-password', password.value);
    return;
  }
  emit('password', password.value);
}
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!--
      Always "not you?", never a bare "back": every arrival here follows a person pick
      (or an auto-select), so this is the shared-device escape hatch — the mitigation
      for a biometric that cannot tell two enrolled faces apart.
    -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('fastLogin.notYou') }}
    </button>

    <!-- Who + family context -->
    <div class="mb-6 text-center">
      <BeanieAvatar
        class="mx-auto mb-3"
        :variant="getMemberAvatarVariant(person)"
        :color="person.color"
        :photo-url="person.photoUrl ?? null"
        size="xl"
      />
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ fillTemplate(t('fastLogin.welcomeBackName'), { name: person.name }) }}
      </h2>
      <p v-if="familyName" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ familyName }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="shownError"
      role="alert"
      class="mb-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ shownError }}
    </div>

    <div class="space-y-4">
      <!-- Method 1: biometric -->
      <button
        v-if="hasBiometric"
        :disabled="isBusy"
        class="group bg-secondary-500 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
        @click="emit('biometric')"
      >
        <template v-if="isBusy">
          <BeanieSpinner size="sm" />
          <span class="font-outfit font-semibold">{{ t('passkey.authenticating') }}</span>
        </template>
        <template v-else>
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
            />
          </svg>
          <span class="font-outfit font-semibold">{{ t('passkey.signInButton') }}</span>
        </template>
      </button>

      <!-- Method 2: tap-through (credential-less member, open pod) -->
      <BaseButton
        v-if="hasTapThrough"
        type="button"
        class="w-full"
        :disabled="isBusy"
        @click="emit('tap-through')"
      >
        {{ `${t('loginV6.signInAs')} ${person.name}` }}
      </BaseButton>

      <!-- Terminal: the password form (create mode for credential-less on an open pod) -->
      <form @submit.prevent="handleSubmit">
        <div v-if="isCreatingPassword">
          <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {{ t('auth.createPasswordPrompt') }}
          </p>
          <BaseInput
            v-model="password"
            :label="t('auth.createPassword')"
            type="password"
            :placeholder="t('auth.createPasswordPlaceholder')"
            required
            @focus="noteFallback"
          />
          <div class="mt-3">
            <BaseInput
              v-model="confirmPassword"
              :label="t('auth.confirmPassword')"
              type="password"
              :placeholder="t('auth.confirmPasswordPlaceholder')"
              required
            />
          </div>
        </div>
        <div v-else>
          <BaseInput
            v-model="password"
            :label="t('auth.password')"
            type="password"
            :placeholder="t('auth.enterYourPassword')"
            required
            @focus="noteFallback"
          />
        </div>

        <BaseButton type="submit" class="mt-4 w-full" :disabled="isBusy">
          {{
            isBusy
              ? t('auth.signingIn')
              : isCreatingPassword
                ? t('auth.createAndSignIn')
                : `${t('loginV6.signInAs')} ${person.name}`
          }}
        </BaseButton>
      </form>
    </div>
  </div>
</template>
