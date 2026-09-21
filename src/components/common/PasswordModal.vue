<script setup lang="ts">
import { ref, computed } from 'vue';
import { BaseModal, BaseButton, BaseInput } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  requireConfirmation?: boolean;
  closable?: boolean;
  externalError?: string | null;
  /**
   * What to CALL the secret this modal is asking for.
   *
   * `tryUnwrapFamilyKey` accepts a member password OR the family recovery passphrase, so
   * a caller decrypting a `.beanpod` must name whichever the envelope can actually take
   * (via `secretFieldFor`). Left unset, the wording stays "Password", which is correct
   * for the step-up caller and was the only behaviour before.
   */
  secretLabel?: string;
  secretPlaceholder?: string;
  /**
   * The empty-field error. Must travel WITH `secretLabel`: a field labelled "Family
   * Passphrase" that answers "Password is required" on an empty submit is the exact
   * label/validation disagreement the shared `secretFieldFor` set exists to prevent.
   */
  secretRequired?: string;
  /**
   * The input's `autocomplete`, decided by `secretFieldFor` rather than here.
   *
   * ⚠️ NOT INFERRED FROM `secretLabel` BEING SET. That was tried and it silently broke
   * autofill for the password-only case: Settings passes `secretLabel` unconditionally,
   * including on the branch where the label IS "Password", so keying off prop presence
   * turned autofill off for exactly the legacy family that depends on it.
   *
   * The rule `secretFieldFor` applies is "autofill only when a password is the ONLY thing
   * this box takes". A family holding both a member password and a recovery passphrase
   * therefore gets `off` and loses autofill, which is a deliberate trade rather than an
   * oversight: either secret is valid in the one field, so a manager that fills the saved
   * password would also offer to OVERWRITE it the moment the passphrase is typed
   * instead. Losing autofill is recoverable; a clobbered sign-in credential, on the
   * screen someone reached because they were locked out, is not.
   */
  secretAutocomplete?: 'current-password' | 'off';
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  description: undefined,
  confirmLabel: undefined,
  requireConfirmation: false,
  closable: true,
  externalError: null,
  secretLabel: undefined,
  secretPlaceholder: undefined,
  secretRequired: undefined,
  secretAutocomplete: 'current-password',
});

const emit = defineEmits<{
  close: [];
  confirm: [password: string];
}>();

const { t } = useTranslation();

const resolvedTitle = computed(() => props.title ?? t('password.enterPassword'));
const resolvedDescription = computed(
  () => props.description ?? t('password.enterPasswordDescription')
);
const resolvedConfirmLabel = computed(() => props.confirmLabel ?? t('action.confirm'));
const resolvedSecretLabel = computed(() => props.secretLabel ?? t('password.password'));
const resolvedSecretPlaceholder = computed(
  () => props.secretPlaceholder ?? t('password.enterPasswordPlaceholder')
);
const resolvedSecretRequired = computed(() => props.secretRequired ?? t('password.required'));

const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const error = ref<string | null>(null);

const passwordsMatch = computed(() => {
  if (!props.requireConfirmation) return true;
  return password.value === confirmPassword.value;
});

const canSubmit = computed(() => {
  if (!password.value) return false;
  if (props.requireConfirmation && !passwordsMatch.value) return false;
  return true;
});

function handleSubmit() {
  error.value = null;

  if (!password.value) {
    error.value = resolvedSecretRequired.value;
    return;
  }

  if (props.requireConfirmation && !passwordsMatch.value) {
    error.value = t('password.mismatch');
    return;
  }

  emit('confirm', password.value);
  resetForm();
}

function handleClose() {
  emit('close');
  resetForm();
}

function resetForm() {
  password.value = '';
  confirmPassword.value = '';
  showPassword.value = false;
  error.value = null;
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="resolvedTitle"
    :closable="closable"
    layer="overlay"
    @close="handleClose"
  >
    <form class="space-y-4" @submit.prevent="handleSubmit">
      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ resolvedDescription }}
      </p>

      <div class="relative">
        <BaseInput
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          :label="resolvedSecretLabel"
          :placeholder="resolvedSecretPlaceholder"
          :autocomplete="secretAutocomplete"
        />
        <button
          type="button"
          class="dark:hover:text-ink-soft absolute top-8 right-3 text-gray-400 hover:text-gray-600"
          @click="showPassword = !showPassword"
        >
          <!-- Eye icon -->
          <svg
            v-if="!showPassword"
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <!-- Eye-off icon -->
          <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
            />
          </svg>
        </button>
      </div>

      <div v-if="requireConfirmation">
        <BaseInput
          v-model="confirmPassword"
          :type="showPassword ? 'text' : 'password'"
          :label="t('password.confirmPassword')"
          :placeholder="t('password.confirmPasswordPlaceholder')"
          autocomplete="new-password"
        />
        <p v-if="confirmPassword && !passwordsMatch" class="mt-1 text-sm text-red-500">
          {{ t('password.mismatch') }}
        </p>
      </div>

      <div v-if="error || externalError" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="dark:text-danger-lift text-sm text-red-600">{{ error || externalError }}</p>
      </div>

      <div class="flex justify-end gap-3 pt-4">
        <BaseButton v-if="closable" variant="ghost" type="button" @click="handleClose">
          {{ t('action.cancel') }}
        </BaseButton>
        <BaseButton type="submit" :disabled="!canSubmit">
          {{ resolvedConfirmLabel }}
        </BaseButton>
      </div>
    </form>
  </BaseModal>
</template>
