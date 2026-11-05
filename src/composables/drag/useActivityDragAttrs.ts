/**
 * Calendar drag and drop (#142): the attributes that make an activity element a drag source.
 *
 * `dragSourceAttrs('move')` (the `dragDom` protocol) plus the "Press Space to move" description,
 * and only for an activity that may move at all (`isDraggableActivity`: not vacation-linked, not
 * soft-deleted) and when the caller says the element is a source (`enabled`: false for an
 * overnight event's next-morning tail, whose head card moves the whole event). Bind it on the
 * element that also carries the reveal hooks (`data-activity-id` / `data-occurrence-date`).
 */
import { useTranslation } from '@/composables/useTranslation';
import type { FamilyActivity } from '@/types/models';
import { dragSourceAttrs } from '@/utils/calendar/dragDom';
import { isDraggableActivity } from '@/utils/calendar/dragMath';

export function useActivityDragAttrs() {
  const { t } = useTranslation();
  return function activityDragAttrs(
    activity: FamilyActivity,
    enabled = true
  ): Record<string, string> {
    return enabled && isDraggableActivity(activity)
      ? { ...dragSourceAttrs('move'), 'aria-description': t('planner.drag.a11y.dragHint') }
      : {};
  };
}
