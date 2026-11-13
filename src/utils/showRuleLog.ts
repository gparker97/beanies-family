/**
 * The show-rule telemetry both stores share (`utils/todoPlate` holds the rule and stays free of
 * the logger). Writes and refusals for to-dos and lists sit on one surface, so one CloudWatch
 * filter isolates the feature. Context reuses the allowlisted `action`, `detail`, `count` and
 * `recur_surface`.
 */
import { logEvent } from '@/services/telemetry/logEvent';
import type { ShowKind, TodoShowRule } from './todoPlate';

export const VISIBILITY_SURFACE = 'todo-visibility';

/**
 * A show rule set (by a store's `setShowRule`), or a non-default one at creation. `action` is
 * the rule actually stored, `detail` the subject's lifecycle, `count` the lead in days. A list's
 * event also carries `recur_surface: 'list'`; a to-do's carries none (unchanged).
 */
export function logShowRuleSet(
  rule: TodoShowRule,
  repeating: boolean,
  kind: ShowKind = 'todo'
): void {
  logEvent({
    level: 'info',
    surface: VISIBILITY_SURFACE,
    message: 'show rule set',
    context: {
      action: rule.kind,
      detail: repeating ? 'repeat' : 'once',
      ...(rule.kind === 'lead' ? { count: rule.days } : {}),
      ...(kind === 'list' ? { recur_surface: 'list' } : {}),
    },
  });
}
