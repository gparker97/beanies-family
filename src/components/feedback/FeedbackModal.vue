<script setup lang="ts">
/**
 * #45 — in-app feedback / NPS modal. Dual-view (mirrors the read/edit precedent):
 *   • form  → BeanieFormModal: NpsScale + adaptive free-text + optional contact.
 *   • thanks → BaseModal: band-appropriate thank-you + "join us on Discord" CTA.
 *
 * Driven by the `useFeedbackModal` singleton (one instance mounted in App.vue).
 * `useFormModal` gives us `isSubmitting` + reset-on-open (entity is always null,
 * so `onNew` fires on every open→true). Submit is optimistic: fire-and-forget to
 * Slack, stamp the cadence clock, then show the thank-you view.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import NpsScale from '@/components/feedback/NpsScale.vue';
import { useFeedbackModal } from '@/composables/useFeedbackModal';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useSettingsStore } from '@/stores/settingsStore';
import { submitFeedback } from '@/utils/feedbackSubmit';
import { npsBand } from '@/utils/feedbackCadence';
import { openDiscord } from '@/utils/discord';

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const { isOpen, close } = useFeedbackModal();

const score = ref<number | null>(null);
const answer = ref('');
const contactName = ref('');
const contactEmail = ref('');
const showContact = ref(false);
const sendAnonymously = ref(false);
const view = ref<'form' | 'thanks'>('form');

// Anonymous and "want a reply?" are opposites — going anonymous collapses + clears
// the contact fields so a submission can never be both anonymous and asking for a reply.
watch(sendAnonymously, (anon) => {
  if (anon) {
    showContact.value = false;
    contactName.value = '';
    contactEmail.value = '';
  }
});

const { isSubmitting } = useFormModal<null>(
  () => null,
  () => isOpen.value,
  {
    onEdit: () => {},
    onNew: () => {
      score.value = null;
      answer.value = '';
      contactName.value = '';
      contactEmail.value = '';
      showContact.value = false;
      sendAnonymously.value = false;
      view.value = 'form';
    },
  }
);

const canSave = computed(() => score.value !== null);

// One adaptive free-text prompt keyed to the selected NPS band (generic until a score is picked).
const adaptivePrompt = computed(() => {
  if (score.value === null) return t('feedback.form.commentGeneric');
  const band = npsBand(score.value);
  if (band === 'detractor') return t('feedback.form.commentDetractor');
  if (band === 'passive') return t('feedback.form.commentPassive');
  return t('feedback.form.commentPromoter');
});

const isPromoter = computed(() => score.value !== null && npsBand(score.value) === 'promoter');
const thanksTitle = computed(() =>
  isPromoter.value ? t('feedback.thanks.promoterTitle') : t('feedback.thanks.defaultTitle')
);
const thanksBody = computed(() =>
  isPromoter.value ? t('feedback.thanks.promoterBody') : t('feedback.thanks.defaultBody')
);

function handleSave(): void {
  if (score.value === null) return;
  isSubmitting.value = true;
  try {
    submitFeedback({
      score: score.value,
      answer: answer.value,
      contactName: contactName.value,
      contactEmail: contactEmail.value,
      anonymous: sendAnonymously.value,
    });
    // Stamp the shared cadence clock so a nav-initiated submit also quiets the auto-prompt.
    void settingsStore.recordFeedbackPrompted();
    view.value = 'thanks';
  } finally {
    isSubmitting.value = false;
  }
}

function handleDiscord(): void {
  openDiscord('feedback');
  close();
}
</script>

<template>
  <!-- Form view -->
  <BeanieFormModal
    :open="isOpen && view === 'form'"
    :title="t('feedback.form.title')"
    icon="💬"
    size="narrow"
    :save-label="t('feedback.form.send')"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    @close="close"
    @save="handleSave"
  >
    <div class="space-y-5">
      <div>
        <p class="font-outfit mb-3 text-base font-semibold text-[var(--color-text)]">
          {{ t('feedback.nps.question') }}
        </p>
        <NpsScale v-model="score" />
      </div>

      <!-- Everything below the score stays hidden until the user answers the NPS
           question — the modal opens as a single, low-friction ask. -->
      <ConditionalSection :show="score !== null">
        <div class="space-y-5">
          <BaseTextarea v-model="answer" :label="adaptivePrompt" :rows="3" />

          <div v-if="!sendAnonymously">
            <button
              type="button"
              class="font-outfit dark:text-ink-soft flex items-center gap-2 text-sm text-[color:rgba(44,62,80,0.7)]"
              :aria-expanded="showContact"
              @click="showContact = !showContact"
            >
              <span
                class="transition-transform"
                :class="showContact ? 'rotate-180' : ''"
                aria-hidden="true"
                >▾</span
              >
              {{ t('feedback.form.contactToggle') }}
            </button>
            <ConditionalSection :show="showContact">
              <div class="space-y-3 pt-3">
                <p class="dark:text-ink-soft text-xs text-[color:rgba(44,62,80,0.55)]">
                  {{ t('feedback.form.contactHelp') }}
                </p>
                <BaseInput
                  v-model="contactName"
                  :placeholder="t('feedback.form.contactNamePlaceholder')"
                />
                <BaseInput
                  v-model="contactEmail"
                  type="email"
                  :placeholder="t('feedback.form.contactEmailPlaceholder')"
                />
              </div>
            </ConditionalSection>
          </div>

          <!-- Send anonymously — off by default. Checked = the family name is left off. -->
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="sendAnonymously" type="checkbox" class="peer sr-only" />
            <span
              class="dark:border-line-strong dark:bg-surface-overlay mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 border-gray-300 bg-white transition-all peer-checked:border-[var(--color-primary)] peer-checked:bg-[var(--color-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[#AED6F1] peer-focus-visible:ring-offset-1"
            >
              <BeanieIcon v-if="sendAnonymously" name="check" size="sm" class="text-white" />
            </span>
            <span
              class="dark:text-ink-soft text-sm leading-relaxed text-[color:rgba(44,62,80,0.75)]"
            >
              {{ t('feedback.form.anonymousLabel') }}
              <span class="dark:text-ink-soft block text-xs text-[color:rgba(44,62,80,0.5)]">
                {{ t('feedback.form.anonymousHint') }}
              </span>
            </span>
          </label>

          <p
            class="dark:text-ink-soft flex items-center gap-1.5 text-xs text-[color:rgba(44,62,80,0.5)]"
          >
            <span aria-hidden="true">🔒</span> {{ t('feedback.form.privacyNote') }}
          </p>
        </div>
      </ConditionalSection>
    </div>
  </BeanieFormModal>

  <!-- Thank-you view -->
  <BaseModal
    :open="isOpen && view === 'thanks'"
    :title="thanksTitle"
    size="sm"
    fullscreen-mobile
    @close="close"
  >
    <div class="space-y-4 py-2 text-center">
      <p class="text-4xl" aria-hidden="true"><span>🫘</span><span>💛</span></p>
      <p class="dark:text-ink-soft text-sm text-[color:rgba(44,62,80,0.7)]">{{ thanksBody }}</p>
      <button
        type="button"
        class="from-primary-500 to-terracotta-400 font-outfit inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
        @click="handleDiscord"
      >
        <span aria-hidden="true">💬</span> {{ t('feedback.thanks.discordCta') }}
      </button>
      <button
        type="button"
        class="dark:text-ink-soft block w-full text-xs text-[color:rgba(44,62,80,0.5)] underline underline-offset-2"
        @click="close"
      >
        {{ t('feedback.thanks.dismiss') }}
      </button>
    </div>
  </BaseModal>
</template>
