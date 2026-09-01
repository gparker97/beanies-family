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

/**
 * A beanie-wall job tick the store REFUSED (`listStore.toggleItem` /
 * `todoStore.toggleComplete` return `null` when the id is not found, and
 * neither toasts on that path — `wrapAsync` only toasts on a throw).
 *
 * On a wall this is the worst failure the feature has: a child ticks a chore,
 * the row looks done, and nothing was written. It must never be silent.
 */
export function reportJobToggleFailed(source: 'todo' | 'list', id: string): void {
  const { t } = useTranslationStore();
  // Developer-facing cause + fix, since the user-facing toast cannot carry it.
  //
  // A null return has TWO causes and we cannot tell them apart here: the record
  // was not found (a genuine refusal), OR `wrapAsync` caught a write failure,
  // toasted, and returned undefined. Say both rather than asserting the wrong
  // one — a triager reading only the first hypothesis chases a phantom.
  console.error(
    `[beanie-wall] ${source} "${id}" was not toggled. Either the record is gone ` +
      '(deleted on another device since this screen last synced) or the write ' +
      'failed and wrapAsync already reported it. Check for a preceding ' +
      'store-write error on the same surface before assuming a missing record.'
  );
  // `silent` because `useWallJobs.toggle` fires its own `reportError` at
  // `critical` right after this. Without it every refused tick produced TWO
  // CloudWatch records with different message strings — translated user copy vs
  // the code's own — which `normalizeMessage` buckets separately, so neither
  // rate-limited the other and the failure rate read double.
  showToast('error', t('wall.jobFailed.title'), t('wall.jobFailed.message'), {
    surface: 'beanie-wall',
    silent: true,
  });
}

/**
 * A beanie-wall list add the store REFUSED. Same shape and reasoning as
 * `reportJobToggleFailed`: `silent` because the caller fires its own critical
 * `reportError`, and a wall has no console for anyone to read.
 */
export function reportListAddFailed(listId: string): void {
  const { t } = useTranslationStore();
  console.error(
    `[beanie-wall] could not add an item to list "${listId}". The list may have ` +
      'been deleted on another device since this screen last synced, or the ' +
      'write failed and wrapAsync already reported it.'
  );
  showToast('error', t('wall.addFailed.title'), t('wall.addFailed.message'), {
    surface: 'beanie-wall',
    silent: true,
  });
}

/**
 * A beanie-wall to-do add the store REFUSED.
 *
 * Its own function rather than reusing `reportListAddFailed`: that one names a
 * LIST in both the toast copy and the console line, so a failed to-do told the
 * family the wrong thing and sent a triager hunting for a list id that was
 * actually the user's typed title.
 */
export function reportTodoAddFailed(): void {
  const { t } = useTranslationStore();
  console.error(
    '[beanie-wall] a to-do could not be created. The write failed and wrapAsync ' +
      'has already reported it; check for a preceding store-write error on this surface.'
  );
  showToast('error', t('wall.addFailed.title'), t('wall.todoAddFailed.message'), {
    surface: 'beanie-wall',
    silent: true,
  });
}
