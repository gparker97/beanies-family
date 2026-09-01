<script setup lang="ts">
/**
 * The wall's home in Settings — where the mode is explained, and where the PIN
 * prerequisite is DEALT WITH rather than merely announced.
 *
 * Entry is gated on the member having a PIN (or a legacy password): leaving the
 * wall is a step-up against their own identity, so a credential-less member
 * could otherwise start a chrome-free mode they could not cleanly leave. The
 * card used to just tell them to go and set one somewhere else, which is a
 * dead end dressed as guidance. Now it opens the real `PinSettings` card in
 * place, watches for the PIN to land, and continues into the wall — the user
 * had to set one anyway, so the two steps become one flow.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import PinSettings from '@/components/settings/PinSettings.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';

const router = useRouter();
const { t } = useTranslation();
const familyStore = useFamilyStore();

const member = computed(() => familyStore.currentMember);
const canEnterWall = computed(() => !!(member.value?.pinHash || member.value?.passwordHash));

const pinModalOpen = ref(false);

function start() {
  if (canEnterWall.value) {
    void router.push('/wall');
    return;
  }
  pinModalOpen.value = true;
}

/**
 * `PinSettings` has no success event — it is a self-contained card over
 * `authStore.setMemberPin`. Watching the member's own `pinHash` appear is the
 * honest signal that the prerequisite is met, and it needs no change to a
 * component seven other places depend on.
 */
watch(canEnterWall, (ready) => {
  if (ready && pinModalOpen.value) {
    pinModalOpen.value = false;
    void router.push('/wall');
  }
});
</script>

<template>
  <BaseCard>
    <h3 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
      {{ t('wall.setup.title') }}
    </h3>
    <p class="text-secondary-400 mt-1 text-sm dark:text-gray-400">
      {{ t('wall.setup.description') }}
    </p>

    <p v-if="!canEnterWall" class="text-secondary-400 mt-3 text-sm dark:text-gray-400">
      {{ t('wall.setup.needsPin.message') }}
    </p>

    <BaseButton class="mt-4" @click="start">
      {{ canEnterWall ? t('wall.setup.start') : t('wall.setup.setPinAndStart') }}
    </BaseButton>

    <BeanieFormModal
      :open="pinModalOpen"
      :title="t('wall.setup.needsPin.title')"
      :save-label="t('action.close')"
      @close="pinModalOpen = false"
      @save="pinModalOpen = false"
    >
      <p class="text-secondary-400 mb-3 text-sm dark:text-gray-400">
        {{ t('wall.setup.needsPin.message') }}
      </p>
      <PinSettings />
    </BeanieFormModal>
  </BaseCard>
</template>
