<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import OptionSurvey, {
  type OptionSurveyAnswer,
  type OptionSurveyOption,
} from '@/components/ui/OptionSurvey.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { HEARD_VIA_IDS, type HeardVia, type HeardViaId } from '@beanies/brand/heardVia';

/**
 * "How did you hear about us?" — a brief, skippable single-question step shown
 * last in the create flow (after the members step, before the setup modal), so its answer can
 * ride the create-pod Slack notification (see ResumePodSetup). Purely
 * presentational; it NEVER blocks pod creation. See
 * docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
 *
 * The option grid and its free-text field are the shared `OptionSurvey`; this host owns the
 * copy, the finish/skip buttons, the telemetry and the mapping of `{ id, text }` to `HeardVia`.
 */
const emit = defineEmits<{
  /** Resolved answer: the stable id (registry) + its Slack label or free text, or null (skip). */
  complete: [heardVia: HeardVia | null];
}>();

const { t } = useTranslation();

/**
 * Single source of truth for the channel options: id → localized label + emoji +
 * a STABLE English Slack label ('other' resolves to the free-text value instead).
 */
const HEARD_OPTION_DEFS: ReadonlyArray<{
  id: HeardViaId;
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
  { id: 'chatgpt_ad', labelKey: 'createSurvey.optChatgptAd', icon: '💬', slackLabel: 'ChatGPT ad' },
  { id: 'ai', labelKey: 'createSurvey.optAi', icon: '🤖', slackLabel: 'ChatGPT / AI search' },
  { id: 'friend', labelKey: 'createSurvey.optFriend', icon: '👋', slackLabel: 'A friend' },
  { id: 'other', labelKey: 'createSurvey.optOther', icon: '✨', slackLabel: null },
];

// The ids come from the shared list (the registry twin pins it); order follows it.
const HEARD_OPTIONS = HEARD_VIA_IDS.map((id) => {
  const def = HEARD_OPTION_DEFS.find((o) => o.id === id);
  if (!def) throw new Error(`createSurvey: no option definition for heardVia id '${id}'`);
  return def;
});

/** Translated at the render site; `other` asks for free text. */
const options = computed<OptionSurveyOption[]>(() =>
  HEARD_OPTIONS.map((def) => ({
    id: def.id,
    label: t(def.labelKey),
    icon: def.icon,
    requiresText: def.id === 'other',
    textPlaceholder: def.id === 'other' ? t('createSurvey.otherPlaceholder') : undefined,
  }))
);

const answer = ref<OptionSurveyAnswer | null>(null);

/**
 * Resolve the answer to `{ id, label }` (or null = skipped). `label` is the Slack string:
 * the stable English label, or for `other` the trimmed free text. `other` with no text typed is
 * a skip (null): `OptionSurvey` reports it as no answer at all.
 */
function resolve(): HeardVia | null {
  const picked = answer.value;
  if (!picked) return null;
  const opt = HEARD_OPTIONS.find((o) => o.id === picked.id);
  if (!opt) return null;
  const label = opt.slackLabel ?? picked.text;
  return label ? { id: opt.id, label } : null;
}

function complete(payload: HeardVia | null) {
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
  let payload: HeardVia | null = null;
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
    // Never let a telemetry hiccup strand the user before the setup modal.
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

    <!-- Options + free text for "somewhere else" -->
    <OptionSurvey v-model="answer" :options="options" testid-prefix="survey" />

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
   stay standard-cased for CI + screen readers. It inherits into `OptionSurvey`, whose
   free-text input opts back out (normal-case) so the user's own typing isn't lower-cased. */
.survey {
  text-transform: lowercase;
}
</style>
