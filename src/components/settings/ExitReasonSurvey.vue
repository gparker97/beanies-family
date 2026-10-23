<script setup lang="ts">
import { computed } from 'vue';
import OptionSurvey, {
  type OptionSurveyAnswer,
  type OptionSurveyOption,
} from '@/components/ui/OptionSurvey.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import {
  EXIT_REASON_IDS,
  EXIT_REASON_TEXT_MAX,
  allowsExitReasonText,
  isExitReasonId,
  type ExitReason,
  type ExitReasonId,
} from '@beanies/brand/exitReason';

/**
 * "Before you go, why are you leaving?": the delete-family drawer's required reason, hosted
 * over the shared `OptionSurvey`. The page owns the answer (`v-model`), the Delete button gate
 * and the `exit-survey` telemetry (`shown` when the drawer opens, `answered` when the reason is
 * actually sent), so this wrapper has none of its own. The id and any free text ride the
 * registry DELETE to the #beanies-leavers line; the Slack labels live in
 * `@beanies/brand/exitReason`, not here. See
 * ~/projects/beanies-ops/docs/plans/2026-10-23-widget-our-day-and-exit-reason.md.
 */
const props = defineProps<{ modelValue: ExitReason | null }>();
const emit = defineEmits<{ 'update:modelValue': [reason: ExitReason | null] }>();

const { t } = useTranslation();

/**
 * One row per id, keyed on the twin list so a NEW id without a row is a type-check failure, never a
 * module-evaluation throw: this file is imported by SettingsPage, so a throw here would blank the
 * whole Settings route, not just the survey. Order on screen follows `EXIT_REASON_IDS`.
 */
const EXIT_OPTION_DEFS: Readonly<
  Record<ExitReasonId, { labelKey: UIStringKey; icon: string; textPlaceholderKey?: UIStringKey }>
> = {
  missing_feature: {
    labelKey: 'settings.deleteFamilyReason.missing_feature',
    icon: '🧩',
    textPlaceholderKey: 'settings.deleteFamilyReasonFeaturePlaceholder',
  },
  design_layout: { labelKey: 'settings.deleteFamilyReason.design_layout', icon: '🎨' },
  too_slow: { labelKey: 'settings.deleteFamilyReason.too_slow', icon: '🐢' },
  no_google_drive: { labelKey: 'settings.deleteFamilyReason.no_google_drive', icon: '☁️' },
  too_complicated: { labelKey: 'settings.deleteFamilyReason.too_complicated', icon: '🧶' },
  privacy_concerns: { labelKey: 'settings.deleteFamilyReason.privacy_concerns', icon: '🔒' },
  switched_app: { labelKey: 'settings.deleteFamilyReason.switched_app', icon: '📲' },
  just_trying: { labelKey: 'settings.deleteFamilyReason.just_trying', icon: '👀' },
  other: {
    labelKey: 'settings.deleteFamilyReason.other',
    icon: '✨',
    textPlaceholderKey: 'settings.deleteFamilyReasonOtherPlaceholder',
  },
};

const options = computed<OptionSurveyOption[]>(() =>
  EXIT_REASON_IDS.map((id) => {
    // eslint-disable-next-line security/detect-object-injection -- `id` comes from the twin list
    const def = EXIT_OPTION_DEFS[id];
    const takesText = allowsExitReasonText(id);
    return {
      id,
      label: t(def.labelKey),
      icon: def.icon,
      requiresText: takesText,
      textPlaceholder: def.textPlaceholderKey ? t(def.textPlaceholderKey) : undefined,
      // The input's `maxlength` counts UTF-16 units, the cap counts code points: stricter on
      // astral text, never looser, so nothing is truncated silently after the fact.
      textMaxLength: takesText ? EXIT_REASON_TEXT_MAX : undefined,
    };
  })
);

function onAnswer(answer: OptionSurveyAnswer | null) {
  if (!answer || !isExitReasonId(answer.id)) {
    emit('update:modelValue', null);
    return;
  }
  emit('update:modelValue', answer.text ? { id: answer.id, text: answer.text } : { id: answer.id });
}
</script>

<template>
  <div>
    <p class="font-outfit dark:text-ink mb-2.5 text-sm font-semibold text-gray-900">
      {{ t('settings.deleteFamilyReasonTitle') }}
    </p>
    <OptionSurvey
      :model-value="props.modelValue"
      :options="options"
      testid-prefix="exit-survey"
      @update:model-value="onAnswer"
    />
  </div>
</template>
