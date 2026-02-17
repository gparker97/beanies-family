<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';

const props = defineProps<{
  open: boolean;
  memberName: string;
  memberEmail: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'create', email: string): void;
}>();

const email = ref(props.memberEmail);
const errorMessage = ref<string | null>(null);

function handleCreate() {
  if (!email.value.trim()) {
    errorMessage.value = 'Email is required';
    return;
  }
  errorMessage.value = null;
  emit('create', email.value);
}
</script>

<template>
  <BaseModal :open="open" title="Create Login Account" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Create a login account for <strong>{{ memberName }}</strong> so they can sign in on their
        own devices.
      </p>

      <BaseInput v-model="email" label="Email" type="email" placeholder="member@example.com" />

      <div
        v-if="errorMessage"
        class="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ errorMessage }}
      </div>

      <div
        class="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
      >
        This feature requires server-side infrastructure (AWS Lambda + Cognito AdminCreateUser API)
        that is not yet deployed. For now, members can sign up themselves and join via sync file.
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton variant="secondary" @click="emit('close')"> Cancel </BaseButton>
        <BaseButton disabled @click="handleCreate"> Create Account </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
