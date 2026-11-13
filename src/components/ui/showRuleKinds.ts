/**
 * How `ShowRuleField` presents each kind of show subject (`ShowKind`, `utils/todoPlate`): the
 * selected-chip accent and the page that always lists the subject (filled into the hints'
 * `{page}`). Presentation only, so it lives beside the field and not in the pure rule core;
 * the one-off default comes from `ONE_OFF_DEFAULT`. A new kind (#146 chores) adds one row.
 */
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ShowKind } from '@/utils/todoPlate';

export interface ShowKindPresentation {
  accent: 'orange' | 'purple';
  pageKey: UIStringKey;
}

export const SHOW_KIND_PRESENTATION: Readonly<Record<ShowKind, ShowKindPresentation>> =
  Object.freeze({
    todo: { accent: 'purple', pageKey: 'todo.show.page' },
    list: { accent: 'orange', pageKey: 'lists.show.page' },
  });
