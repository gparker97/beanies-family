<script setup lang="ts">
/**
 * Transfer Pod Ownership flow — three-step BeanieFormModal:
 *   1. `pick`    — select an adult human (not the current owner)
 *   2. `reauth`  — re-authenticate via passkey or password
 *   3. `confirm` — final confirmation, then call familyStore.transferOwnership
 *
 * Single host modal — no nested BaseModal/ConfirmModal stacking. The
 * password sub-flow inside ReauthChallenge is the only legitimate
 * second layer, and only when the user actually picks the password
 * verification path.
 */
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import ReauthChallenge from '@/components/auth/ReauthChallenge.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

type Step = 'pick' | 'reauth' | 'confirm';
const step = ref<Step>('pick');
const selectedId = ref('');
const isSubmitting = ref(false);

const currentOwner = computed(() => familyStore.owner);

/**
 * Adult humans who have joined the pod, excluding the current owner.
 * Recipients must be adults to prevent accidental transfer to a child's
 * account; pets are excluded by sortedHumans. `requiresPassword === false`
 * is the canonical "has joined" signal — invitees who have not set up
 * their account yet have no auth identity, so they cannot exercise
 * ownership; transferring to them would strand the pod with no working
 * owner. The store-level transferOwnership guard enforces the same rule
 * as defense in depth.
 */
const eligibleRecipients = computed(() =>
  familyStore.sortedHumans.filter(
    (m) => m.ageGroup === 'adult' && m.requiresPassword === false && m.id !== currentOwner.value?.id
  )
);

const targetMember = computed(() => familyStore.members.find((m) => m.id === selectedId.value));

const stepTitle = computed(() => {
  switch (step.value) {
    case 'pick':
      return t('transferOwnership.pickTitle');
    case 'reauth':
      return t('transferOwnership.reauthTitle');
    case 'confirm':
      return t('transferOwnership.confirmTitle');
  }
  return t('transferOwnership.entryTitle');
});

const saveLabel = computed(() => {
  switch (step.value) {
    case 'pick':
      return t('transferOwnership.continue');
    case 'reauth':
      return t('transferOwnership.continue');
    case 'confirm':
      return t('transferOwnership.confirmAction');
  }
  return t('transferOwnership.continue');
});

const saveDisabled = computed(() => {
  if (step.value === 'pick') return !selectedId.value;
  if (step.value === 'reauth') return true; // ReauthChallenge drives advancement via @verified
  return false;
});

const confirmMessage = computed(() => {
  const name = targetMember.value?.name ?? '';
  return t('transferOwnership.confirmMessage').replace('{name}', name);
});

function reset() {
  step.value = 'pick';
  selectedId.value = '';
  isSubmitting.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  }
);

function handleSave() {
  if (step.value === 'pick') {
    if (!selectedId.value) return;
    step.value = 'reauth';
    return;
  }
  if (step.value === 'confirm') {
    void executeTransfer();
  }
}

async function executeTransfer() {
  if (!selectedId.value) return;
  isSubmitting.value = true;
  try {
    const ok = await familyStore.transferOwnership(selectedId.value);
    if (ok) {
      const name = targetMember.value?.name ?? '';
      showToast('success', t('transferOwnership.success').replace('{name}', name), undefined, {
        surface: 'transferOwnership',
      });
      emit('close');
    } else {
      // familyStore already reportError'd the reason; surface inline failure.
      showToast('error', t('transferOwnership.failed'), undefined, {
        surface: 'transferOwnership',
      });
    }
  } catch (e) {
    // wrapAsync inside transferOwnership catches store-level throws,
    // so reaching here means an unexpected exception bubbled up. Report.
    showToast('error', t('transferOwnership.failed'), undefined, {
      surface: 'transferOwnership',
      error: e,
    });
  } finally {
    isSubmitting.value = false;
  }
}

function handleVerified() {
  step.value = 'confirm';
}

function handleReauthCancelled() {
  step.value = 'pick';
}

function handleClose() {
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="stepTitle"
    icon="👑"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    size="default"
    save-gradient="orange"
    @close="handleClose"
    @save="handleSave"
  >
    <!-- Step 1: pick a recipient -->
    <div v-if="step === 'pick'" class="space-y-4">
      <p class="dark:text-ink-soft text-sm text-gray-600">
        {{ t('transferOwnership.pickDescription') }}
      </p>
      <div
        class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
      >
        <p class="dark:text-terracotta-lift text-sm text-amber-800">
          {{ t('transferOwnership.warning') }}
        </p>
      </div>
      <p
        v-if="eligibleRecipients.length === 0"
        class="dark:text-ink-soft text-sm text-gray-500 italic"
      >
        {{ t('transferOwnership.noEligibleRecipients') }}
      </p>
      <FamilyChipPicker v-else v-model="selectedId" mode="single" :members="eligibleRecipients" />
    </div>

    <!-- Step 2: re-authenticate -->
    <!-- Keeps the transfer-specific wording now that ReauthChallenge defaults to
         action-neutral copy for the shared gate (#80). -->
    <ReauthChallenge
      v-else-if="step === 'reauth' && currentOwner"
      description-key="transferOwnership.reauthDescription"
      no-credential-key="transferOwnership.reauthNoCredential"
      :member="currentOwner"
      :open="step === 'reauth'"
      @verified="handleVerified"
      @cancelled="handleReauthCancelled"
    />

    <!-- Step 3: final confirmation -->
    <div v-else-if="step === 'confirm'" class="space-y-3">
      <p class="dark:text-ink-soft text-sm text-gray-700">
        {{ confirmMessage }}
      </p>
      <div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
        <p class="dark:text-danger-lift text-sm text-red-700">
          {{ t('transferOwnership.warning') }}
        </p>
      </div>
    </div>
  </BeanieFormModal>
</template>
