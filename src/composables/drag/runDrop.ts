/**
 * Calendar drag and drop (#142): what one drop does, between the binding (which knows WHERE
 * it landed) and the orchestrator (`commitCalendarMove`, which writes and toasts a saved
 * move). Every `dropPatch` result is handled here, so no outcome is silent:
 *
 * - `patch` → `commitCalendarMove` (logs and toasts saved / cancelled / refused / failed);
 * - `noop` (dropped where it was) → the `drop` event only, no write, no toast;
 * - `refused` (a resize under 15 minutes or past midnight) → an info toast, the chip springs back;
 * - `invalid` (the stored time cannot be read) → `reportError`, the chip springs back.
 *
 * Returns the live-region line for the outcome.
 */
import { commitCalendarMove, dropWhenLabel, logDrop } from '@/composables/useCalendarMove';
import { reportDragFault } from '@/composables/drag/dragTelemetry';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { DragInput } from '@/utils/calendar/dragGesture';
import {
  dropPatch,
  type DragGesture,
  type DragSource,
  type DragView,
  type DropTarget,
} from '@/utils/calendar/dragMath';
import { fillTemplate } from '@/utils/fillTemplate';

export interface DropRequest {
  source: DragSource;
  target: DropTarget;
  view: DragView;
  gesture: DragGesture;
  input: DragInput;
}

export async function runDrop(req: DropRequest): Promise<string> {
  const { t } = useTranslationStore();
  const { source, target, gesture } = req;
  const ctx = { source, view: req.view, gesture, input: req.input };
  const members = useFamilyStore().members;
  const isKnownMember = (id: string) => members.some((m) => m.id === id);
  const result = dropPatch(source, target, gesture, isKnownMember);
  const cancelled = t('planner.drag.a11y.cancelled');

  switch (result.kind) {
    case 'patch': {
      const outcome = await commitCalendarMove({
        ...ctx,
        patch: result.patch,
        effect: result.effect,
      });
      if (outcome.kind !== 'saved') return cancelled;
      return fillTemplate(t('planner.drag.a11y.dropped'), {
        title: source.activity.title,
        when: dropWhenLabel(target),
      });
    }
    case 'noop':
      logDrop(ctx, 'noop');
      return cancelled;
    case 'refused':
      showToast(
        'info',
        t(result.reason === 'too-short' ? 'planner.drag.tooShort' : 'planner.drag.crossesMidnight')
      );
      logDrop(ctx, 'refused');
      return cancelled;
    case 'invalid':
      reportDragFault('A dragged activity has an unreadable stored time', {
        action: 'drop',
        detail: result.reason,
        activity_id: source.activity.id,
      });
      logDrop(ctx, 'invalid');
      return cancelled;
  }
}
