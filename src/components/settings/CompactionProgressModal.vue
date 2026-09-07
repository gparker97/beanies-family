<script setup lang="ts">
/**
 * What is happening while a family file is tidied up, and what to do afterwards.
 *
 * ⚠️ WHY THIS EXISTS. The whole run — the pre-flight pull, the backup, the
 * rebuild, the publish — happened with NO indicator at all, on an operation that
 * is one-way and changes the file for everyone. The outcome then arrived as a
 * toast that dismissed itself after a few seconds, carrying two things that
 * deserved far better: the before/after sizes, which are the only evidence the
 * family gets that this was worth doing, and — the one that matters — the names
 * of the people who are cut off until they update.
 *
 * Under beanpod 5.0 that second one is not cosmetic. A build predating the
 * lineage guard REFUSES a compacted file at parse and stops syncing, so anything
 * those people add before updating is not kept. "Go and open Sophia's iPad" is
 * the single most actionable sentence beanies ever says, and it was being shown
 * for four seconds in a corner.
 *
 * It reuses the create-pod `SetupProgressModal` convention rather than inventing
 * one: same beanie, same bar, same step list, same shape. Two deliberate
 * departures, both because this is maintenance rather than a beginning — no
 * confetti and no fanfare (they would fire on a screen someone opened to fix a
 * problem), and the completion panel is a to-do list rather than a celebration.
 *
 * State lives in `usePodCompaction`; this component only renders it. The steps
 * advance where the code advances, so a step can never claim progress the run
 * has not made.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = defineProps<{
  open: boolean;
  /** -1 before the first step, 0-3 while running, 4 when all four are done. */
  step: number;
  phase: 'running' | 'done' | 'failed';
  stats: { beforeBytes: number; afterBytes: number } | null;
  errorKey: UIStringKey | null;
  /** Members still on a build that cannot open a compacted file. */
  behind: string[];
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();

/**
 * The four phases of `usePodCompaction.compact()`, in order.
 *
 * ⚠️ FOUR, NOT FIVE OR SIX. Each maps to a real boundary in that function where
 * something can genuinely fail: the gates + pull, the backup + safety copy, the
 * worker rebuild, the publish. A step that cannot fail is decoration, and
 * decoration in a progress list is a lie about where the run actually is.
 */
const STEPS: { glyph: string; labelKey: UIStringKey }[] = [
  { glyph: '👀', labelKey: 'compactionProgress.step0' },
  { glyph: '💾', labelKey: 'compactionProgress.step1' },
  { glyph: '🧹', labelKey: 'compactionProgress.step2' },
  { glyph: '📤', labelKey: 'compactionProgress.step3' },
];

const percent = computed(() => {
  if (props.phase === 'done') return 100;
  return Math.max(0, Math.min(100, Math.round((props.step / STEPS.length) * 100)));
});

/** One decimal for MB, none for KB — a family file is rarely under a megabyte. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const savedLine = computed(() => {
  if (!props.stats) return '';
  const { beforeBytes, afterBytes } = props.stats;
  const saved = Math.max(0, beforeBytes - afterBytes);
  const pct = beforeBytes > 0 ? Math.round((saved / beforeBytes) * 100) : 0;
  return fillTemplate(t('compactionProgress.saved'), {
    amount: formatBytes(saved),
    percent: String(pct),
  });
});

/**
 * ⚠️ CLOSABLE ONLY WHEN THE RUN HAS ENDED. A compaction interrupted half way is
 * exactly the state the safety copy exists for; offering an X mid-run invites
 * it. Once it has finished — either way — the person dismisses it themselves,
 * which is the whole point of not using a toast.
 */
const closable = computed(() => props.phase !== 'running');
</script>

<template>
  <BaseModal
    :open="open"
    size="sm"
    :closable="closable"
    layer="overlay"
    fullscreen-mobile
    @close="closable && emit('close')"
  >
    <div class="px-1 py-2">
      <img
        src="/brand/beanies_celebrating_circle_transparent_400x400.png"
        alt=""
        class="mx-auto mb-4 h-20 w-20 object-contain drop-shadow-md"
      />

      <h2 class="font-outfit dark:text-ink text-center text-xl font-bold text-[#2C3E50]">
        {{
          phase === 'done'
            ? t('compactionProgress.doneTitle')
            : phase === 'failed'
              ? t('compactionProgress.failedTitle')
              : t('compactionProgress.title')
        }}
      </h2>
      <p class="dark:text-ink-faint mb-5 text-center text-sm text-gray-500">
        {{
          phase === 'done'
            ? t('compactionProgress.doneSubtitle')
            : phase === 'failed'
              ? t('compactionProgress.failedSubtitle')
              : t('compactionProgress.subtitle')
        }}
      </p>

      <!-- Progress + steps: while running, and on a failure so the person can
           see WHICH step stopped. -->
      <template v-if="phase !== 'done'">
        <div class="mb-4">
          <div
            class="dark:bg-surface-overlay h-1.5 overflow-hidden rounded-full bg-[rgba(44,62,80,0.06)]"
          >
            <div
              class="h-full rounded-full bg-gradient-to-r from-[#F15D22] to-[#E67E22] transition-all duration-500 ease-out"
              :style="{ width: `${percent}%` }"
            />
          </div>
        </div>

        <ul class="mb-5 flex flex-col gap-1.5">
          <li
            v-for="(s, i) in STEPS"
            :key="i"
            class="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors"
            :class="
              i === step && phase === 'running'
                ? 'dark:bg-accent-lift/10 dark:text-ink bg-[rgba(241,93,34,0.08)] font-semibold text-[#2C3E50]'
                : 'dark:text-ink-soft text-gray-500'
            "
          >
            <span class="flex w-5 flex-shrink-0 justify-center">
              <BeanieSpinner v-if="i === step && phase === 'running'" size="xs" />
              <span
                v-else-if="i < step"
                class="dark:text-success-lift text-base text-[#27AE60]"
                aria-hidden="true"
                >✓</span
              >
              <span v-else aria-hidden="true">{{ s.glyph }}</span>
            </span>
            <span>{{ t(s.labelKey) }}</span>
          </li>
        </ul>
      </template>

      <!-- The result. The one lifted object on the card. -->
      <div
        v-if="phase === 'done' && stats"
        class="dark:bg-success-lift/10 mb-4 rounded-2xl bg-[rgba(39,174,96,0.09)] p-4 text-center"
      >
        <p class="font-outfit flex items-baseline justify-center gap-2">
          <span class="dark:text-ink-faint text-lg font-semibold text-gray-400 line-through">{{
            formatBytes(stats.beforeBytes)
          }}</span>
          <span class="dark:text-success-lift text-base text-[#27AE60]" aria-hidden="true">→</span>
          <span class="dark:text-ink text-2xl font-bold text-[#2C3E50]">{{
            formatBytes(stats.afterBytes)
          }}</span>
        </p>
        <p class="dark:text-ink-soft mt-1 text-xs text-gray-500">{{ savedLine }}</p>
      </div>

      <!-- ⚠️ THE PANEL THIS MODAL EXISTS FOR. Named people, what each must do,
           and what happens if they don't. Heritage Orange, never Alert Red:
           nothing is broken and nothing is lost. -->
      <div
        v-if="phase === 'done' && behind.length > 0"
        class="dark:bg-accent-lift/10 mb-4 rounded-2xl bg-[rgba(241,93,34,0.08)] p-4"
      >
        <p class="font-outfit dark:text-ink mb-2 text-sm font-bold text-[#2C3E50]">
          {{ t('compactionProgress.todoTitle') }}
        </p>
        <ul class="flex flex-col gap-2">
          <li v-for="name in behind" :key="name">
            <p class="dark:text-ink text-sm font-semibold text-[#2C3E50]">{{ name }}</p>
            <p class="dark:text-ink-soft text-xs text-gray-500">
              {{ t('compactionProgress.todoItem') }}
            </p>
          </li>
        </ul>
        <p class="dark:text-ink-faint mt-3 text-xs text-gray-400">
          {{ t('compactionProgress.todoFoot') }}
        </p>
      </div>

      <p
        v-else-if="phase === 'done'"
        class="dark:text-ink-soft mb-4 text-center text-sm text-gray-500"
      >
        {{ t('compactionProgress.doneNothingToDo') }}
      </p>

      <!-- A refusal or a failure, in the place the person is already looking. -->
      <div
        v-if="phase === 'failed' && errorKey"
        class="dark:bg-accent-lift/10 mb-4 rounded-2xl bg-[rgba(241,93,34,0.08)] p-4"
      >
        <p class="dark:text-ink text-sm text-[#2C3E50]">{{ t(errorKey) }}</p>
      </div>

      <BaseButton v-if="phase !== 'running'" variant="primary" full-width @click="emit('close')">
        {{ t('action.done') }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
