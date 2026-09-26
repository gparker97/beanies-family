import { ref, type Ref } from 'vue';

export interface DragPayloadApi<T> {
  dragged: Ref<T | null>;
  startDrag: (payload: T, event?: DragEvent) => void;
  endDrag: () => void;
}

/**
 * Builds a composable for one kind of drag payload, backed by a module-level
 * singleton ref so a drag source and its drop targets share it without prop
 * drilling. Call it ONCE at module scope per payload type
 * (`export const useMealDrag = createDragPayload<MealDragPayload>('beanies-meal')`),
 * so each board gets its own ref and one board's drag can never be read as
 * another's. Drag-and-drop is a pointer-only enhancement; the tap path stays
 * the canonical, keyboard-accessible one.
 *
 * @param dataTag written to `dataTransfer` as `text/plain`. The value is unused
 *   (drop targets read the ref), it only exists to make Firefox start the drag.
 */
export function createDragPayload<T>(dataTag: string): () => DragPayloadApi<T> {
  const dragged = ref<T | null>(null) as Ref<T | null>;

  function startDrag(payload: T, event?: DragEvent): void {
    dragged.value = payload;
    // Firefox CANCELS a drag whose `dragstart` sets no dataTransfer data — so a
    // module-ref-only payload silently kills the whole drag flow there. Setting
    // any data (the value is unused; we read the ref) makes the drag start.
    if (event?.dataTransfer) {
      event.dataTransfer.setData('text/plain', dataTag);
      event.dataTransfer.effectAllowed = 'move';
    }
  }
  function endDrag(): void {
    dragged.value = null;
  }

  return () => ({ dragged, startDrag, endDrag });
}
