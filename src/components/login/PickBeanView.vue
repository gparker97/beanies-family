<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import { isTemporaryEmail } from '@/utils/email';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import type { FamilyMember, PasskeyRegistration } from '@/types/models';
import { useBiometricSignIn } from '@/composables/useBiometricSignIn';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
}>();

const password = ref('');
const confirmPassword = ref('');
const selectedMember = ref<FamilyMember | null>(null);
const formError = ref<string | null>(null);

// Pets can't sign in, so exclude them from the login picker. Ordered
// adults -> children via sortedHumans so the picker matches the roster
// order the user sees everywhere else in the app.
const allMembers = computed(() => familyStore.sortedHumans);
const podName = computed(() => familyContextStore.activeFamilyName);

const isCreatingPassword = computed(
  () => selectedMember.value && !selectedMember.value.passwordHash
);

const { isAuthenticating, signIn: biometricSignIn } = useBiometricSignIn();
/** memberIds that can be signed in with a biometric ON THIS DEVICE. */
const deviceKeyMemberIds = ref<Set<string>>(new Set());

/**
 * Does the SELECTED bean have a key here? Only the selected-member panel offers
 * biometric — the avatar grid deliberately shows nothing, because its status slot is
 * already a two-state indicator (has a password / needs to create one) and a third
 * meaning there would either destroy that signal or need a stacked badge.
 */
const selectedHasDeviceKey = computed(
  () => !!selectedMember.value && deviceKeyMemberIds.value.has(selectedMember.value.id)
);

onMounted(async () => {
  const familyId = familyContextStore.activeFamilyId;
  if (!familyId) return;
  // Guarded: a throw here would take out the whole picker mount, and the biometric offer
  // is an enhancement — never a reason the password form fails to appear.
  let keys: PasskeyRegistration[] = [];
  try {
    keys = await authStore.resolveDeviceKeysForFamily(familyId);
  } catch (e) {
    reportError({
      surface: 'pick-bean',
      message: 'could not resolve device keys — biometric offer suppressed',
      error: e,
      severity: 'warning',
    });
  }
  deviceKeyMemberIds.value = new Set(keys.map((k) => k.memberId));

  // Emitted once per mount, not per member: six beans would otherwise burn the
  // 50/surface/min client cap for no extra signal. Counts ride inside `detail`
  // because `count` is not an allowlisted context key.
  logEvent({
    level: 'info',
    surface: 'native-biometric',
    message: 'picker_offer',
    context: {
      action: keys.length > 0 ? 'offered' : 'not_offered',
      detail: `keys=${keys.length}/beans=${allMembers.value.length}`,
    },
  });
});

/**
 * Biometric sign-in for the bean the user just picked. The pod is normally already
 * decrypted on this surface, so the key's job here is identification, not decryption.
 */
async function handleBiometricSignIn() {
  const member = selectedMember.value;
  if (!member) return;
  formError.value = null;

  const result = await biometricSignIn(familyContextStore.activeFamilyId!, member.id);
  logEvent({
    level: 'info',
    surface: 'native-biometric',
    message: 'picker_unlock',
    context: {
      action: result.ok ? 'ok' : result.message === null ? 'cancelled' : 'error',
      member_id_tail: member.id.slice(-8),
    },
  });

  if (result.ok) {
    emit('signed-in', '/nook');
    return;
  }
  // `null` is a deliberate silence (the user dismissed the prompt); anything else — a
  // mismatch included — says so and leaves the password field right there beneath it.
  formError.value = result.message;
}

function selectMember(member: FamilyMember) {
  selectedMember.value = member;
  password.value = '';
  confirmPassword.value = '';
  formError.value = null;
}

function clearSelection() {
  selectedMember.value = null;
  password.value = '';
  confirmPassword.value = '';
  formError.value = null;
}

function getMemberRole(member: FamilyMember): string {
  if (member.ageGroup === 'child') {
    return t('loginV6.littleBean');
  }
  return t('loginV6.parentBean');
}

async function handleSignIn() {
  formError.value = null;
  try {
    await runSignIn();
  } catch (e) {
    // Previously unguarded: a throw from setPassword/signIn left the form silent and
    // dead, with no message and no spinner to explain itself.
    formError.value = e instanceof Error ? e.message : t('auth.signInFailed');
    reportError({
      surface: 'pick-bean',
      message: 'sign-in threw',
      error: e,
      severity: 'warning',
    });
  }
}

async function runSignIn() {
  if (!selectedMember.value) {
    formError.value = t('auth.selectMember');
    return;
  }

  if (!password.value) {
    formError.value = t('auth.enterPassword');
    return;
  }

  // If member has no password yet, create one
  if (isCreatingPassword.value) {
    if (password.value.length < 8) {
      formError.value = t('auth.passwordMinLength');
      return;
    }
    if (password.value !== confirmPassword.value) {
      formError.value = t('auth.passwordsDoNotMatch');
      return;
    }

    const result = await authStore.setPassword(selectedMember.value.id, password.value);
    if (result.success) {
      // No setupAutoSync here: LoginPage.handleSignedIn is the single arm-and-register
      // point for every entry path. `syncNowBounded` is the one home for the bounded,
      // rejection-swallowing push — hand-rolling `raceTimeout` again is what left two
      // copies of it behind in the first place.
      await syncStore.syncNowBounded();
      emit('signed-in', '/nook');
    } else {
      formError.value = result.error ?? t('auth.signInFailed');
    }
    return;
  }

  // Normal sign-in with existing password
  const result = await authStore.signIn(selectedMember.value.id, password.value);
  if (result.success) {
    emit('signed-in', '/nook');
  } else {
    formError.value = result.error ?? t('auth.signInFailed');
  }
}
</script>

<template>
  <div class="mx-auto max-w-[480px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="selectedMember ? clearSelection() : $emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header -->
    <div class="mb-6 text-center">
      <!-- Pod name chip with provider context -->
      <div v-if="podName" class="mx-auto mb-3 flex flex-col items-center gap-1">
        <div
          class="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-slate-700 dark:text-gray-400"
        >
          <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          {{ podName }}
        </div>
        <CloudProviderBadge
          v-if="syncStore.fileName"
          :provider-type="syncStore.storageProviderType"
          :file-name="syncStore.fileName"
          :account-email="syncStore.providerAccountEmail"
          size="sm"
        />
      </div>

      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.pickBeanTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.pickBeanSubtitle') }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- No members -->
    <div v-if="allMembers.length === 0" class="py-4 text-center">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.noMembersWithPassword') }}
      </p>
    </div>

    <!-- Avatar grid (shown when no member selected) -->
    <div v-else-if="!selectedMember" class="flex flex-wrap justify-center gap-6">
      <button
        v-for="member in allMembers"
        :key="member.id"
        class="group flex w-[88px] flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
        @click="selectMember(member)"
      >
        <div class="relative">
          <BeanieAvatar
            :variant="getMemberAvatarVariant(member)"
            :color="member.color"
            :photo-url="getMemberAvatarUrl(member)"
            size="xl"
            @photo-error="markMemberAvatarError(member)"
          />
          <!-- Status indicator -->
          <div
            v-if="member.passwordHash"
            class="absolute right-0 bottom-0 h-4 w-4 rounded-full border-2 border-white bg-green-400 dark:border-slate-800"
          ></div>
          <div
            v-else
            class="bg-primary-500 absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-slate-800"
          >
            +
          </div>
        </div>
        <div class="text-center">
          <p
            class="font-outfit max-w-[88px] truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {{ member.name }}
          </p>
          <p class="text-xs text-gray-400 opacity-60">
            {{ getMemberRole(member) }}
          </p>
        </div>
      </button>
    </div>

    <!-- Info bubble (shown when no member selected and members exist) -->
    <div
      v-if="allMembers.length > 0 && !selectedMember"
      class="mt-6 flex items-start gap-3 rounded-2xl bg-gray-50 p-[14px_18px] dark:bg-slate-700/50"
    >
      <div
        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#6EE7B7]/[0.12]"
      >
        <svg class="h-4 w-4 text-[#6EE7B7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <p class="text-xs font-semibold opacity-50">
        {{ t('loginV6.pickBeanInfoText') }}
      </p>
    </div>

    <!-- Password form (shown when member selected) -->
    <form v-if="selectedMember" @submit.prevent="handleSignIn">
      <!-- Selected member card -->
      <div class="mb-4 flex items-center gap-3 rounded-2xl bg-gray-50 p-4 dark:bg-slate-700/50">
        <BeanieAvatar
          :variant="getMemberAvatarVariant(selectedMember)"
          :color="selectedMember.color"
          :photo-url="getMemberAvatarUrl(selectedMember)"
          size="lg"
          @photo-error="markMemberAvatarError(selectedMember)"
        />
        <div class="flex-1">
          <p class="font-outfit font-semibold text-gray-900 dark:text-gray-100">
            {{ selectedMember.name }}
          </p>
          <p
            v-if="!isTemporaryEmail(selectedMember.email)"
            class="text-xs text-gray-500 dark:text-gray-400"
          >
            {{ selectedMember.email }}
          </p>
        </div>
        <button
          v-if="allMembers.length > 1"
          type="button"
          class="text-primary-500 hover:text-terracotta-400 text-sm font-medium"
          @click="clearSelection"
        >
          {{ t('action.change') }}
        </button>
      </div>

      <!--
        Biometric offer for THIS bean, above the password field — which stays visible and
        fully usable, so this is an extra door rather than a gate. Shown only when this
        bean has a key on this device; a bean without one simply sees today's form, with
        nothing hinting that anything failed (requirement 4 is satisfied by silence).
      -->
      <BaseButton
        v-if="selectedHasDeviceKey && !isCreatingPassword"
        type="button"
        variant="secondary"
        class="mb-4 w-full"
        :disabled="isAuthenticating"
        @click="handleBiometricSignIn"
      >
        {{ isAuthenticating ? t('passkey.authenticating') : t('passkey.signInButton') }}
      </BaseButton>

      <!-- Creating password for first time -->
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

      <!-- Normal sign-in -->
      <div v-else>
        <BaseInput
          v-model="password"
          :label="t('auth.password')"
          type="password"
          :placeholder="t('auth.enterYourPassword')"
          required
        />
      </div>

      <BaseButton type="submit" class="mt-4 w-full" :disabled="authStore.isLoading">
        {{
          authStore.isLoading
            ? t('auth.signingIn')
            : isCreatingPassword
              ? t('auth.createAndSignIn')
              : `${t('loginV6.signInAs')} ${selectedMember.name}`
        }}
      </BaseButton>
    </form>
  </div>
</template>
