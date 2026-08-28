<script setup lang="ts">
/**
 * Member PIN management (login rethink Phase 2). Set or change the signed-in member's
 * 6-digit PIN — the family-wide identity secret that also fast-unlocks this device.
 * All writes go through authStore.setMemberPin (doc hash + version bump + this device's
 * wrap + bounded push); this card is a renderer over that one action.
 */
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import PinInput from '@/components/ui/PinInput.vue';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { PIN_LENGTH, isValidPin } from '@/services/auth/deviceUnlock';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();

const isEditing = ref(false);
const currentPin = ref('');
const newPin = ref('');
const confirmPin = ref('');
const isSaving = ref(false);
const statusMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);

const me = computed(() =>
  familyStore.members.find((m) => m.id === authStore.currentUser?.memberId)
);
const hasPin = computed(() => !!me.value?.pinHash);

onMounted(() => {
  statusMessage.value = null;
});

function startEditing() {
  isEditing.value = true;
  statusMessage.value = null;
  currentPin.value = '';
  newPin.value = '';
  confirmPin.value = '';
}

function cancelEditing() {
  isEditing.value = false;
  statusMessage.value = null;
}

async function handleSave() {
  statusMessage.value = null;
  if (!me.value) return;
  if (!isValidPin(newPin.value)) {
    statusMessage.value = { text: t('pin.invalidFormat'), type: 'error' };
    return;
  }
  if (newPin.value !== confirmPin.value) {
    statusMessage.value = { text: t('pin.mismatch'), type: 'error' };
    return;
  }
  isSaving.value = true;
  try {
    const result = await authStore.setMemberPin(
      me.value.id,
      newPin.value,
      hasPin.value ? currentPin.value : undefined
    );
    if (result.success) {
      statusMessage.value = { text: t('pin.setSuccess'), type: 'success' };
      isEditing.value = false;
    } else {
      statusMessage.value = { text: result.error ?? t('auth.signInFailed'), type: 'error' };
    }
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <BaseCard :title="hasPin ? t('pin.changeTitle') : t('pin.setTitle')">
    <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
      {{ t('pin.settingsDescription') }}
    </p>

    <div
      v-if="statusMessage"
      role="alert"
      class="mb-4 rounded-xl p-3 text-sm"
      :class="
        statusMessage.type === 'success'
          ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
          : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
      "
    >
      {{ statusMessage.text }}
    </div>

    <div v-if="!isEditing">
      <BaseButton variant="secondary" @click="startEditing">
        {{ hasPin ? t('pin.changeTitle') : t('pin.setTitle') }}
      </BaseButton>
    </div>

    <form v-else class="space-y-4" @submit.prevent="handleSave">
      <div v-if="hasPin">
        <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('pin.currentPin') }}
        </p>
        <PinInput
          v-model="currentPin"
          :disabled="isSaving"
          :label="t('pin.currentPin')"
          autofocus
        />
      </div>
      <div>
        <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('pin.newPin') }}
        </p>
        <PinInput
          v-model="newPin"
          :disabled="isSaving"
          :label="t('pin.newPin')"
          :autofocus="!hasPin"
        />
      </div>
      <div>
        <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('pin.confirmPin') }}
        </p>
        <PinInput v-model="confirmPin" :disabled="isSaving" :label="t('pin.confirmPin')" />
      </div>
      <div class="flex gap-3">
        <BaseButton
          type="submit"
          :disabled="isSaving || newPin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH"
        >
          {{ isSaving ? t('common.saving') : t('action.save') }}
        </BaseButton>
        <BaseButton type="button" variant="ghost" :disabled="isSaving" @click="cancelEditing">
          {{ t('action.cancel') }}
        </BaseButton>
      </div>
    </form>
  </BaseCard>
</template>
