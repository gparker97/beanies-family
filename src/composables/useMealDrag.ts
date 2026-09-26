import type { MealKind } from '@/types/models';
import { createDragPayload } from '@/composables/useDragPayload';

/**
 * What is currently being dragged onto the meal board, shared by the recipe rail
 * (drag source) and the board cells (drop targets). The tap picker is the canonical,
 * keyboard-accessible path and works without any of this.
 */
export type MealDragPayload =
  | { source: 'recipe'; recipeId: string }
  | { source: 'type'; kind: MealKind }
  | { source: 'meal'; mealId: string };

export const useMealDrag = createDragPayload<MealDragPayload>('beanies-meal');
