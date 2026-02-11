<script setup lang="ts">
import { ref, computed } from 'vue';
import { BaseModal, BaseButton, BaseInput } from '@/components/ui';

interface Props {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  requireConfirmation?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Enter Password',
  description: 'Enter your encryption password to continue.',
  confirmLabel: 'Confirm',
  requireConfirmation: false,
});

const emit = defineEmits<{
  close: [];
  confirm: [password: string];
}>();

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
    error.value = 'Password is required';
    return;
  }

  if (props.requireConfirmation && !passwordsMatch.value) {
    error.value = 'Passwords do not match';
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
  <BaseModal :open="open" :title="title" @close="handleClose">
    <form class="space-y-4" @submit.prevent="handleSubmit">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ description }}
      </p>

      <div class="relative">
        <BaseInput
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          label="Password"
          placeholder="Enter password"
          autocomplete="current-password"
        />
        <button
          type="button"
          class="absolute top-8 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
          label="Confirm Password"
          placeholder="Confirm password"
          autocomplete="new-password"
        />
        <p v-if="confirmPassword && !passwordsMatch" class="mt-1 text-sm text-red-500">
          Passwords do not match
        </p>
      </div>

      <div v-if="error" class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      </div>

      <div class="flex justify-end gap-3 pt-4">
        <BaseButton variant="ghost" type="button" @click="handleClose"> Cancel </BaseButton>
        <BaseButton type="submit" :disabled="!canSubmit">
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </form>
  </BaseModal>
</template>
