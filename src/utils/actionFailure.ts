/**
 * Shared reporters for "the store refused" — a non-throw failure that returns
 * `null`/`false` instead of raising (record-not-found, a guard refusal, a repo
 * write that came back empty).
 *
 * These paths used to fail silently: the user taps Save or Delete, nothing
 * happens, and nothing is reported. `showToast('error', …)` auto-fires the
 * error reporter with the given `surface`/`context` (see `useToast.ts:24-56`),
 * so one call both tells the user and lands a structured event in CloudWatch.
 *
 * Two reporters, not one, because the copy genuinely differs: an activity
 * *session* and a recurring *bill* are different nouns to the user. Both reuse
 * existing translated strings — this module adds no new copy.
 */
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

/**
 * A recurring-ACTIVITY session action the store refused (materialize / split /
 * cancel-one returned null, or a vacation-linked delete was refused).
 */
export function reportSessionActionFailed(): void {
  const { t } = useTranslationStore();
  showToast(
    'error',
    t('planner.sessionActionFailed.title'),
    t('planner.sessionActionFailed.message'),
    {
      surface: 'activity-session-action',
    }
  );
}

/**
 * A recurring-ITEM (bill) scope action the store refused. Deliberately does NOT
 * reuse `planner.sessionActionFailed.*` — that copy reads "Couldn't update this
 * session", which is wrong for a bill the user just tried to cancel.
 */
export function reportRecurringItemActionFailed(): void {
  const { t } = useTranslationStore();
  showToast('error', t('error.saveFailed'), t('error.generic'), {
    surface: 'recurring-item-scope',
  });
}
