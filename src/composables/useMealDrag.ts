import { ref } from 'vue';
import type { MealKind } from '@/types/models';

/**
 * What is currently being dragged onto the meal board. A module-level singleton
 * so the recipe rail (drag source) and the board cells (drop targets) share it
 * without prop drilling. Drag-and-drop is a pointer-only enhancement — the tap
 * picker is the canonical, keyboard-accessible path and works without any of this.
 */
export type MealDragPayload =
  | { source: 'recipe'; recipeId: string }
  | { source: 'type'; kind: MealKind }
  | { source: 'meal'; mealId: string };

const dragged = ref<MealDragPayload | null>(null);

export function useMealDrag() {
  function startDrag(payload: MealDragPayload): void {
    dragged.value = payload;
  }
  function endDrag(): void {
    dragged.value = null;
  }
  return { dragged, startDrag, endDrag };
}
