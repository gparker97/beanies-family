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
import type { UIStringKey } from '@/services/translation/uiStrings';

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
 * ONE body for every "the wall's store refused" report.
 *
 * The three wall reporters below were the same two statements with different
 * nouns, and a fourth near-copy would have stated the pattern four times and
 * named it never. The load-bearing part is the `{ surface: 'beanie-wall',
 * silent: true }` pairing, which is exactly the thing that must not drift:
 * `silent` because every caller fires its own `reportError` at `critical` right
 * after, and without it a refusal produced TWO CloudWatch records with
 * different message strings (translated user copy vs the code's own), which
 * `normalizeMessage` buckets separately, so neither rate-limited the other and
 * the failure rate read double.
 *
 * The console line is the developer's half: a wall has no console anyone is
 * reading at the time, so it must carry a cause AND a fix for whoever opens the
 * logs later.
 */
function reportWallFailure(
  consoleLine: string,
  titleKey: UIStringKey,
  messageKey: UIStringKey
): void {
  const { t } = useTranslationStore();

  console.error(consoleLine);
  showToast('error', t(titleKey), t(messageKey), {
    surface: 'beanie-wall',
    silent: true,
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
  // A null return has TWO causes and we cannot tell them apart here: the record
  // was not found (a genuine refusal), OR `wrapAsync` caught a write failure,
  // toasted, and returned undefined. Say both rather than asserting the wrong
  // one — a triager reading only the first hypothesis chases a phantom.
  reportWallFailure(
    `[beanie-wall] ${source} "${id}" was not toggled. Either the record is gone ` +
      '(deleted on another device since this screen last synced) or the write ' +
      'failed and wrapAsync already reported it. Check for a preceding ' +
      'store-write error on the same surface before assuming a missing record.',
    'wall.jobFailed.title',
    'wall.jobFailed.message'
  );
}

/**
 * A beanie-wall list add the store REFUSED. Same shape and reasoning as
 * `reportJobToggleFailed`: `silent` because the caller fires its own critical
 * `reportError`, and a wall has no console for anyone to read.
 */
export function reportListAddFailed(listId: string): void {
  reportWallFailure(
    `[beanie-wall] could not add an item to list "${listId}". The list may have ` +
      'been deleted on another device since this screen last synced, or the ' +
      'write failed and wrapAsync already reported it.',
    'wall.addFailed.title',
    'wall.addFailed.message'
  );
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
  reportWallFailure(
    '[beanie-wall] a to-do could not be created. The write failed and wrapAsync ' +
      'has already reported it; check for a preceding store-write error on this surface.',
    'wall.addFailed.title',
    'wall.todoAddFailed.message'
  );
}

/**
 * A beanie-wall rename, remove or undo the store REFUSED.
 *
 * One function with a three-value discriminator rather than three functions:
 * the cases differ only in a verb, and that verb is already carried in
 * telemetry as `action`. Rename deliberately reuses the existing
 * `wall.jobFailed.*` copy, which already says exactly the right thing about a
 * write that did not save.
 */
export function reportJobEditFailed(
  op: 'rename' | 'remove' | 'undo',
  source: 'todo' | 'list',
  id: string
): void {
  const copy = {
    rename: ['wall.jobFailed.title', 'wall.jobFailed.message'],
    remove: ['wall.removeFailed.title', 'wall.removeFailed.message'],
    undo: ['wall.undoFailed.title', 'wall.undoFailed.message'],
  } as const satisfies Record<string, readonly [UIStringKey, UIStringKey]>;
  const [titleKey, messageKey] = copy[op];
  reportWallFailure(
    `[beanie-wall] could not ${op} the ${source} "${id}". Either the record is gone ` +
      '(deleted on another device since this screen last synced) or the write failed ' +
      'and wrapAsync already reported it. Check for a preceding store-write error on ' +
      'this surface before assuming a missing record.',
    titleKey,
    messageKey
  );
}
