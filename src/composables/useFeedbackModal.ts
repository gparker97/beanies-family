/**
 * #45 — shared open-state for the in-app feedback / NPS modal.
 *
 * Module singleton (one modal mounted in App.vue) so the two permanent entry
 * points (sidebar + hamburger footers) and the periodic auto-prompt all drive the
 * same instance without touching NAV_ITEMS. `maybeAutoPromptFeedback()` is the
 * try/catch-wrapped auto-trigger the notifications daemon calls — the decision,
 * the cadence stamp, and fault-isolation all live here.
 */
import { ref } from 'vue';
import { reportError } from '@/utils/errorReporter';
import { decideFeedbackPrompt } from '@/utils/feedbackCadence';
import { claimInterruption } from '@/composables/useSessionInterruption';

export type FeedbackSource = 'nav' | 'auto';

const isOpen = ref(false);
const source = ref<FeedbackSource | null>(null);

function openFeedback(src: FeedbackSource): void {
  source.value = src;
  isOpen.value = true;
}

function close(): void {
  isOpen.value = false;
}

/**
 * Auto-open the feedback prompt if the cadence is due AND this session's single
 * interruption slot is still free. Called from `useNotifications`' session-ready
 * seam (after the what's-new auto-open, so notifications claims first → the survey
 * is strictly lowest priority). Eligibility is checked BEFORE claiming so an
 * ineligible session never consumes the slot. Never throws (reports + swallows) so
 * a fault can't break the notifications daemon. Requires the settings store's
 * `recordFeedbackPrompted` action to stamp the cadence clock.
 */
function maybeAutoPromptFeedback(settingsStore: {
  feedbackOptOut: boolean;
  settings: { createdAt?: string; feedbackLastPromptedAt?: string };
  recordFeedbackPrompted: () => Promise<void> | void;
}): void {
  try {
    if (isOpen.value) return;
    const due = decideFeedbackPrompt(
      {
        optOut: settingsStore.feedbackOptOut,
        lastPromptedAt: settingsStore.settings.feedbackLastPromptedAt,
        accountCreatedAt: settingsStore.settings.createdAt,
      },
      Date.now()
    );
    if (!due) return;
    if (!claimInterruption('feedback')) return;
    void settingsStore.recordFeedbackPrompted();
    openFeedback('auto');
  } catch (err) {
    reportError({
      surface: 'feedback-auto-prompt',
      severity: 'error',
      message: 'feedback auto-prompt failed',
      error: err,
    });
  }
}

export function useFeedbackModal() {
  return { isOpen, source, openFeedback, close, maybeAutoPromptFeedback };
}
