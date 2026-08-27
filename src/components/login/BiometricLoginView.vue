<script setup lang="ts">
import { computed } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { useBiometricSignIn } from '@/composables/useBiometricSignIn';
import { ref } from 'vue';
import type { PasskeyRegistration } from '@/types/models';

const props = defineProps<{
  familyId: string;
  familyName?: string;
  /**
   * The keys this device holds for this family, resolved once by LoginPage. Passing them
   * in rather than re-querying keeps one registry read per family selection, and lets the
   * cold-start chooser label each key before the pod (and therefore the member roster)
   * has been decrypted.
   */
  deviceKeys: PasskeyRegistration[];
}>();

const emit = defineEmits<{
  'signed-in': [destination: string];
  'use-password': [context?: { crossDevice: true; memberId: string; credentialId?: string }];
  back: [];
}>();

const { t } = useTranslation();
const syncStore = useSyncStore();
const { isAuthenticating, signIn } = useBiometricSignIn();

const errorMessage = ref<string | null>(null);
/**
 * WHICH chooser button is mid-prompt. `isAuthenticating` is a single shared flag, so using
 * it directly would spin every button at once and hide all the names — leaving the user
 * unable to see who they just tapped.
 */
const pendingMemberId = ref<string | null>(null);
const crossDeviceContext = ref<{
  crossDevice: true;
  memberId: string;
  credentialId?: string;
} | null>(null);

/** More than one bean has enrolled on this device, so the user must say which is them. */
const needsChooser = computed(() => props.deviceKeys.length > 1);

async function handleBiometricLogin(memberId: string) {
  errorMessage.value = null;
  // Cleared per attempt: the cross-device banner outranks the error block in the
  // template, so leaving it set would silently swallow every subsequent message.
  crossDeviceContext.value = null;
  pendingMemberId.value = memberId;
  let result;
  try {
    result = await signIn(props.familyId, memberId);
  } finally {
    pendingMemberId.value = null;
  }

  if (result.ok) {
    emit('signed-in', '/nook');
    return;
  }
  if ('crossDevice' in result) {
    errorMessage.value = result.message;
    crossDeviceContext.value = { crossDevice: true, ...result.crossDevice };
    return;
  }
  // A null message is a deliberate silence (the user dismissed the prompt).
  errorMessage.value = result.message;
}

/** The single-key case, which is every device until someone else enrols here. */
function handleSingleKeyLogin() {
  const only = props.deviceKeys[0];
  if (only) void handleBiometricLogin(only.memberId);
}
</script>

<template>
  <div class="flex flex-col items-center">
    <!-- Back button -->
    <button
      class="mb-4 flex w-full items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      <!--
        Always "not you?", never a bare "back". Every route into this view now auto-enters
        a member the user did not choose (a single family auto-selects; the family picker
        lands here too), so this is the escape hatch for a shared device — the whole
        mitigation for a biometric that cannot tell two enrolled faces apart. It used to
        be conditional on single-family auto-select, which was false on exactly the path
        that most needs it.
      -->
      {{ t('fastLogin.notYou') }}
    </button>

    <!-- Family name -->
    <div class="mb-6 text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-3 h-16 w-16"
      />
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{
          familyName
            ? fillTemplate(t('fastLogin.welcomeBackName'), { name: familyName })
            : t('passkey.welcomeBack')
        }}
      </h2>
      <!-- File/provider context -->
      <CloudProviderBadge
        v-if="syncStore.fileName"
        class="mt-1"
        :provider-type="syncStore.storageProviderType"
        :file-name="syncStore.fileName"
        :account-email="syncStore.providerAccountEmail"
        size="sm"
      />
    </div>

    <!-- Biometric button -->
    <div class="w-full space-y-4">
      <!--
        Two or more beans have enrolled on this device, so we cannot know which one is
        holding the phone — the OS prompt certainly cannot tell. Ask first, then unlock
        that bean's own key. Labels come from the registration record because at this
        point the pod is still encrypted, so there is no member roster to read names from.
      -->
      <div v-if="needsChooser" class="space-y-2">
        <p class="text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('fastLogin.whoIsSigningIn') }}
        </p>
        <button
          v-for="key in deviceKeys"
          :key="key.credentialId"
          :disabled="isAuthenticating"
          :aria-busy="pendingMemberId === key.memberId"
          class="group bg-secondary-500 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
          @click="handleBiometricLogin(key.memberId)"
        >
          <!--
            `memberName` names the BEAN; `label` names the DEVICE ("Face ID · Safari, iOS")
            and is identical for everyone enrolled on this phone — useless for telling two
            people apart, which is the entire job of this chooser. Older records predate
            the field, so fall back rather than render nothing.
          -->
          <BeanieSpinner v-if="pendingMemberId === key.memberId" size="sm" />
          <span class="font-outfit font-semibold">{{ key.memberName || key.label }}</span>
        </button>
      </div>

      <button
        v-else
        :disabled="isAuthenticating"
        class="group bg-secondary-500 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
        @click="handleSingleKeyLogin"
      >
        <template v-if="isAuthenticating">
          <BeanieSpinner size="sm" />
          <span class="font-outfit font-semibold">{{ t('passkey.authenticating') }}</span>
        </template>
        <template v-else>
          <!-- Fingerprint icon -->
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

      <!-- Cross-device info message -->
      <div
        v-if="crossDeviceContext"
        class="rounded-xl border border-[#AED6F1] bg-[#AED6F1]/10 p-4 text-center text-sm text-gray-700 dark:border-slate-600 dark:bg-slate-700/50 dark:text-gray-300"
      >
        <p>{{ t('passkey.crossDeviceNoCache') }}</p>
        <button
          class="mt-3 font-medium text-[#F15D22] underline"
          @click="emit('use-password', crossDeviceContext)"
        >
          {{ t('passkey.usePassword') }}
        </button>
      </div>

      <!-- Error message -->
      <div
        v-else-if="errorMessage"
        role="alert"
        class="rounded-xl bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ errorMessage }}
        <button
          v-if="!needsChooser"
          class="mt-2 block w-full text-center text-xs font-medium text-red-700 underline dark:text-red-300"
          @click="handleSingleKeyLogin"
        >
          {{ t('action.tryAgain') }}
        </button>
      </div>

      <!-- Password fallback -->
      <button
        v-if="!crossDeviceContext"
        class="w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        @click="emit('use-password')"
      >
        {{ t('passkey.usePassword') }}
      </button>
    </div>
  </div>
</template>
