import { showToast } from '@/composables/useToast';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreBatchResult } from '@/stores/choreStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * The ONE result toast for a chore batch (#146): Add Chores and Copy Chores. Nothing new is an
 * info toast ("nothing new to add"); otherwise the caller's own "added" line, with how many were
 * skipped as duplicates underneath. A `null` result never reaches here: the store has already
 * toasted its refusal or failure.
 */
export function showChoreBatchToast(
  result: ChoreBatchResult,
  addedKeys: { one: UIStringKey; other: UIStringKey },
  t: (key: UIStringKey) => string
): void {
  if (result.added === 0) {
    showToast('info', t('choreboard.batch.nothingNew'));
    return;
  }
  const added = fillTemplate(t(result.added === 1 ? addedKeys.one : addedKeys.other), {
    count: result.added,
  });
  const skipped = result.skipped
    ? fillTemplate(
        t(result.skipped === 1 ? 'choreboard.batch.skipped.one' : 'choreboard.batch.skipped.other'),
        { count: result.skipped }
      )
    : undefined;
  showToast('success', added, skipped);
}
