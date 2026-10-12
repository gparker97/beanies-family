/**
 * Typed telemetry facade for the `home-widget` surface (#130, ADR-042).
 *
 * One narrow function per event, wrapping `logEvent`, so the surface's vocabulary lives in
 * one file (the `loginFlowEvents.ts` shape). Used by `useWidgetSnapshot` (publish, placements,
 * the relayed native read outcome) and `inboundLinkBridge` (opens from a widget). Native
 * code cannot log; everything the widget knows reaches CloudWatch through the app.
 *
 * Context discipline: every field rides on an ALREADY-ALLOWLISTED key (`kind`, `count`,
 * `action`, `detail`, `error_code`, `route_path`; see ALLOWED_CONTEXT_KEYS in
 * diagnosticContext.ts), so no store-declaration change ships with this surface. No member
 * name, title or snapshot content is ever logged, and values that arrive from outside the
 * app (the `w` query param, the native `readOutcome`) are checked against a fixed set first.
 */

import { logEvent, type LogLevel } from '@/services/telemetry/logEvent';
import type { WidgetSize } from '@/types/widgetSnapshot';

const SURFACE = 'home-widget';

/** What triggered a publish: a data/settings change (incl. the midnight roll) or a foreground. */
export type WidgetRefreshReason = 'data-change' | 'foreground';

function emit(level: LogLevel, message: string, context: Record<string, unknown>): void {
  logEvent({ level, surface: SURFACE, message, context });
}

/**
 * A snapshot reached the native side. Emitted on EVERY success so the publish rate is
 * measurable. `detail` is always `tasks=<n>;ahead=<n>;kb=<n>`, plus `;skipped=<n>` only when
 * a part was dropped by a malformed record: filter on `skipped=`, never on `detail` existing.
 */
export function emitSnapshotPublished(payload: {
  reason: WidgetRefreshReason;
  /** Rows on today's "my day", the widget's default view. */
  rowsToday: number;
  /** Tasks in today's "my day" to-dos section (before the cap). */
  tasksToday: number;
  /** Calendar rows on the six look-ahead days of "my day". */
  aheadRows: number;
  /** The snapshot JSON's size, in whole kilobytes (rounded up). */
  kb: number;
  skipped: number;
}): void {
  // Fixed `key=<int>` tokens only, so `detail` never carries free text. Enough to tell "the
  // widget is empty" apart: no rows today, no tasks, nothing ahead, or a part that threw.
  const detail = [
    `tasks=${payload.tasksToday}`,
    `ahead=${payload.aheadRows}`,
    `kb=${payload.kb}`,
    ...(payload.skipped > 0 ? [`skipped=${payload.skipped}`] : []),
  ].join(';');
  emit('info', 'snapshot published', {
    kind: payload.reason,
    count: payload.rowsToday,
    action: 'publish',
    detail,
  });
}

/** Placed widgets, one event per size with at least one placement. */
export function emitPlacements(placements: Partial<Record<WidgetSize, number>>): void {
  for (const [size, count] of Object.entries(placements)) {
    if (!count || count <= 0) continue;
    emit('info', 'placements', { kind: size, count });
  }
}

/**
 * The fixed token grammar native writes for a read failure (B3/C1/B6/C2). Anything else is
 * logged as `unrecognised` rather than echoed, so this key can never carry free text.
 */
const READ_OUTCOME_TOKENS: readonly RegExp[] = [
  /^read_failed$/,
  /^read_failed;[a-z_]{1,40}$/,
  /^render_failed$/,
  /^decode_failed;v=-?\d{1,6}$/,
  /^decode_failed;v=unknown$/,
  /^placements_failed;[A-Za-z_]{1,40}$/,
  /^placements_failed;code=-?\d{1,9}$/,
  /^reload_failed;[A-Za-z_]{1,40}$/,
];

/** Whether a relayed native read outcome matches the fixed token grammar. */
export function isReadOutcomeToken(outcome: string): boolean {
  return READ_OUTCOME_TOKENS.some((pattern) => pattern.test(outcome));
}

/**
 * The widget could not read the snapshot (relayed by the next publish). Native may join
 * several tokens with `|` (iOS relays a read failure and a placements failure together);
 * each part is checked on its own and an unknown part is replaced, never echoed.
 */
export function emitReadOutcome(outcome: string): void {
  for (const part of outcome.split('|')) {
    if (!isReadOutcomeToken(part)) {
      emit('warn', 'widget read failed', {
        error_code: 'snapshot_unreadable',
        detail: 'unrecognised',
      });
      continue;
    }
    // Three different failures share this relay; each gets its own error_code so an alert
    // on "the widget could not read its data" is not inflated by render or count failures.
    if (part.startsWith('reload_failed')) {
      emit('warn', 'widget re-render failed', { error_code: 'widget_reload_failed', detail: part });
    } else if (part.startsWith('placements_failed')) {
      emit('warn', 'widget placements unavailable', {
        error_code: 'placements_failed',
        detail: part,
      });
    } else {
      emit('warn', 'widget read failed', { error_code: 'snapshot_unreadable', detail: part });
    }
  }
}

/**
 * Sign-out stopped waiting for an in-flight publish (`timeout`) or it failed (`failed`)
 * before the snapshot delete ran. The delete still ran; this says the halt was incomplete.
 */
export function emitSignOutHaltIncomplete(outcome: 'timeout' | 'failed'): void {
  emit('warn', 'sign-out halt incomplete', { error_code: 'halt_' + outcome, stage: 'sign-out' });
}

/** A widget tap opened the app (`?src=widget&w=<size>`, size already validated). */
export function emitWidgetOpened(payload: { size: WidgetSize; routePath: string }): void {
  emit('info', 'opened from widget', { kind: payload.size, route_path: payload.routePath });
}

/**
 * `src=widget` with a `w` that is not a known size. The value is NOT logged: any app can
 * deliver an Intent with arbitrary query text. Its rate is the signal.
 */
export function emitWidgetOpenInvalid(): void {
  emit('warn', 'opened from widget with an unknown size', { error_code: 'widget_param_invalid' });
}
