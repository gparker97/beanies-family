<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * "How did you hear about us?" — a brief, skippable single-question step shown
 * after the password (identity) step and before finalize, so its answer can
 * ride the create-pod Slack notification (see ResumePodSetup). Purely
 * presentational; it NEVER blocks pod creation. See
 * docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
 */
const emit = defineEmits<{
  /** Resolved answer: a stable English Slack label, free text, or null (skip). */
  complete: [heardVia: string | null];
}>();

const { t } = useTranslation();

/**
 * Single source of truth for the channel options: id → localized label + emoji +
 * a STABLE English Slack label ('other' resolves to the free-text value instead).
 */
const HEARD_OPTIONS: ReadonlyArray<{
  id: string;
  labelKey: UIStringKey;
  icon: string;
  slackLabel: string | null;
}> = [
  { id: 'reddit', labelKey: 'createSurvey.optReddit', icon: '👽', slackLabel: 'Reddit' },
  {
    id: 'product_hunt',
    labelKey: 'createSurvey.optProductHunt',
    icon: '🚀',
    slackLabel: 'Product Hunt',
  },
  {
    id: 'substack',
    labelKey: 'createSurvey.optSubstack',
    icon: '📮',
    slackLabel: 'Substack / blog',
  },
  { id: 'google', labelKey: 'createSurvey.optGoogle', icon: '🔍', slackLabel: 'Google search' },
  { id: 'app_store', labelKey: 'createSurvey.optAppStore', icon: '📱', slackLabel: 'App store' },
  { id: 'ai', labelKey: 'createSurvey.optAi', icon: '🤖', slackLabel: 'ChatGPT / AI search' },
  { id: 'friend', labelKey: 'createSurvey.optFriend', icon: '👋', slackLabel: 'A friend' },
  { id: 'other', labelKey: 'createSurvey.optOther', icon: '✨', slackLabel: null },
];

const selectedId = ref<string | null>(null);
const otherText = ref('');
const showOther = computed(() => selectedId.value === 'other');

function select(id: string) {
  // Single-select; tapping the selected tile clears it.
  selectedId.value = selectedId.value === id ? null : id;
}

/** Resolve the selection to the Slack string (or null = no attribution). */
function resolve(): string | null {
  if (!selectedId.value) return null;
  const opt = HEARD_OPTIONS.find((o) => o.id === selectedId.value);
  if (!opt) return null;
  if (opt.id === 'other') {
    const txt = otherText.value.trim();
    return txt.length ? txt : null;
  }
  return opt.slackLabel;
}

function complete(payload: string | null) {
  // Only the answered/skipped OUTCOME goes to the firehose — never the channel
  // or free text (those go to Slack only; logging them would need a new
  // allowlisted context key + privacy-manifest churn).
  logEvent({
    level: 'info',
    surface: 'create-survey',
    message: payload ? 'answered' : 'skipped',
    context: { action: payload ? 'answered' : 'skipped' },
  });
  emit('complete', payload);
}

function finish() {
  let payload: string | null = null;
  try {
    payload = resolve();
  } catch (error) {
    // Degrade to skip — a survey must never be able to block pod creation.
    reportError({
      surface: 'create-survey',
      severity: 'warning',
      message: 'survey answer resolution failed — skipping',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    payload = null;
  }
  complete(payload);
}

function skip() {
  complete(null);
}

onMounted(() => {
  try {
    // E2E seam: auto-skip so the create-pod spec proceeds to finalize unchanged
    // (emit directly — no 'skipped' telemetry for a synthetic run).
    if (import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true') {
      emit('complete', null);
      return;
    }
    logEvent({
      level: 'info',
      surface: 'create-survey',
      message: 'shown',
      context: { action: 'shown' },
    });
  } catch {
    // Never let a telemetry hiccup strand the user before finalize.
    emit('complete', null);
  }
});
</script>

<template>
  <div class="survey">
    <!-- Hero -->
    <div class="mb-4 text-center">
      <div class="flex items-center justify-center gap-1">
        <PageWelcomeSubtitle :text="t('createSurvey.eyebrow')" />
        <span aria-hidden="true">🌱</span>
      </div>
      <h2 class="font-outfit dark:text-ink mt-1 mb-1 text-xl font-bold text-gray-900">
        {{ t('createSurvey.title') }}
      </h2>
      <p class="dark:text-ink-soft mx-auto max-w-xs text-sm text-gray-500">
        {{ t('createSurvey.subtitle') }}
      </p>
    </div>

    <!-- Options -->
    <div class="grid grid-cols-2 gap-2.5">
      <button
        v-for="opt in HEARD_OPTIONS"
        :key="opt.id"
        type="button"
        :aria-pressed="selectedId === opt.id"
        :data-testid="`survey-opt-${opt.id}`"
        class="font-outfit flex items-center gap-2.5 rounded-[14px] border-[1.5px] p-3 text-left text-sm font-semibold transition-colors"
        :class="
          selectedId === opt.id
            ? 'border-primary-500 dark:text-ink bg-[var(--tint-orange-8)] text-gray-900'
            : 'dark:border-line-strong dark:text-ink border-[var(--tint-slate-5)] text-gray-700 hover:border-[var(--silk)]'
        "
        @click="select(opt.id)"
      >
        <span
          class="dark:bg-surface-overlay grid h-7 w-7 shrink-0 place-items-center rounded-[10px] bg-[var(--tint-slate-5)] text-base"
          aria-hidden="true"
          >{{ opt.icon }}</span
        >
        {{ t(opt.labelKey) }}
      </button>
    </div>

    <!-- Free text for "somewhere else" -->
    <input
      v-if="showOther"
      v-model="otherText"
      type="text"
      :placeholder="t('createSurvey.otherPlaceholder')"
      data-testid="survey-other-input"
      class="dark:bg-surface-overlay dark:text-ink mt-2.5 w-full rounded-xl border-[1.5px] border-[var(--silk)] p-3 text-base text-gray-900 normal-case focus:ring-2 focus:ring-[var(--silk)] focus:outline-none"
    />

    <!-- Finish + skip (both complete the flow; the survey never blocks) -->
    <button
      type="button"
      class="from-primary-500 to-terracotta-400 font-outfit mt-4 w-full rounded-2xl bg-gradient-to-br py-3.5 text-sm font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
      data-testid="survey-finish"
      @click="finish"
    >
      {{ t('createSurvey.cta') }}
    </button>
    <button
      type="button"
      class="dark:text-ink-faint dark:hover:text-ink-soft mt-3 w-full text-center text-sm text-gray-400 hover:text-gray-600"
      data-testid="survey-skip"
      @click="skip"
    >
      {{ t('onboarding.skip') }}
    </button>
  </div>
</template>

<style scoped>
/* All display copy renders lowercase (warm brand voice); underlying t() strings
   stay standard-cased for CI + screen readers. The free-text input opts back out
   (normal-case) so the user's own typing isn't visually lower-cased. */
.survey {
  text-transform: lowercase;
}
</style>
