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
import {
  CIRCLE_SHOW_OPTIONS,
  type CircleShowOption,
  type WidgetSize,
} from '@/types/widgetSnapshot';
import type { WidgetPlacements } from '@/services/native/widgetBridgePlugin';

const SURFACE = 'home-widget';

/** What triggered a publish: a data/settings change (incl. the midnight roll) or a foreground. */
export type WidgetRefreshReason = 'data-change' | 'foreground';

function emit(level: LogLevel, message: string, context: Record<string, unknown>): void {
  logEvent({ level, surface: SURFACE, message, context });
}

/**
 * A snapshot reached the native side. Emitted on EVERY success so the publish rate is
 * measurable. `detail` is always `tasks=<n>;ahead=<n>;kb=<n>;wx=<0|1>` (`wx=1`: the snapshot
 * carried a weather reading, #134), plus `;skipped=<n>` only when a part was dropped by a
 * malformed record, plus `;day=<n>` only when the native side said which day it painted
 * (Android): `day=0` is today, `day=-1` a widget still on yesterday. Filter on `skipped=` /
 * `day=` / `wx=`, never on `detail` existing.
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
  /** The snapshot carried weather (`snapshot.weather` non-null). */
  weather: boolean;
  /** Days from the app's today to the day the widgets painted (Android); absent on iOS. */
  renderedDayOffset?: number;
}): void {
  // Fixed `key=<int>` tokens only, so `detail` never carries free text. Enough to tell "the
  // widget is empty" apart: no rows today, no tasks, nothing ahead, or a part that threw.
  const detail = [
    `tasks=${payload.tasksToday}`,
    `ahead=${payload.aheadRows}`,
    `kb=${payload.kb}`,
    `wx=${payload.weather ? 1 : 0}`,
    ...(payload.skipped > 0 ? [`skipped=${payload.skipped}`] : []),
    ...(payload.renderedDayOffset !== undefined ? [`day=${payload.renderedDayOffset}`] : []),
  ].join(';');
  emit('info', 'snapshot published', {
    kind: payload.reason,
    count: payload.rowsToday,
    action: 'publish',
    detail,
  });
}

/** Short names in the `circle=` token, in `CIRCLE_SHOW_OPTIONS` order. Never rename one. */
const CIRCLE_TOKEN_NAMES: Readonly<Record<CircleShowOption, string>> = {
  nextUp: 'nextUp',
  nextHandoff: 'handoff',
  todosLeft: 'todos',
  thingsLeft: 'left',
};

/** A relayed native count as a small non-negative integer (anything else reads as 0). */
function safeCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999) : 0;
}

/**
 * `circle=nextUp:1,handoff:0,todos:0,left:0`: every option, always in the same order, so a
 * CloudWatch filter can match one option's count. Fixed tokens and integers only.
 */
export function circleOptionsToken(circle: Partial<Record<CircleShowOption, number>>): string {
  return `circle=${CIRCLE_SHOW_OPTIONS.map((o) => `${CIRCLE_TOKEN_NAMES[o]}:${safeCount(circle[o])}`).join(',')}`;
}

/**
 * Placed widgets, one event per size with at least one placement. The circle option counts
 * (iOS, #134) ride the `ios-accessory` event as its `detail` token, since circles are
 * accessories.
 */
export function emitPlacements(placements: WidgetPlacements): void {
  const { circle, ...sizes } = placements;
  for (const [size, count] of Object.entries(sizes) as [WidgetSize, number | undefined][]) {
    if (!count || count <= 0) continue;
    emit('info', 'placements', {
      kind: size,
      count,
      ...(size === 'ios-accessory' && circle ? { detail: circleOptionsToken(circle) } : {}),
    });
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
  /^list_failed;[A-Za-z_]{1,40}$/,
];

/**
 * Failure families that get their own message and error_code, matched on the token's name (the
 * part before ';'). Any other valid token is a snapshot read failure (`snapshot_unreadable`).
 */
const OUTCOME_ROUTES = [
  { name: 'reload_failed', message: 'widget re-render failed', code: 'widget_reload_failed' },
  {
    name: 'placements_failed',
    message: 'widget placements unavailable',
    code: 'placements_failed',
  },
  { name: 'list_failed', message: 'widget list failed', code: 'widget_list_failed' },
] as const;

/** Whether a relayed native read outcome matches the fixed token grammar. */
export function isReadOutcomeToken(outcome: string): boolean {
  return READ_OUTCOME_TOKENS.some((pattern) => pattern.test(outcome));
}

/**
 * The native widget's failures since the last publish (relayed by that publish). A refused
 * `updateAppWidget` (`reload_failed`), an unavailable placements count and a list that could
 * not be built each get their own error_code (OUTCOME_ROUTES); everything else, a snapshot
 * read or decode failure and a renderer throw (`render_failed`), stays `snapshot_unreadable`.
 * Native joins several tokens with `|`; each part is checked on its own and an unknown part is
 * replaced, never echoed.
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
    // Each failure family gets its own error_code (OUTCOME_ROUTES), so an alert on "the widget
    // could not read its data" is not inflated by re-render, count or list failures.
    const name = part.split(';')[0];
    const route = OUTCOME_ROUTES.find((r) => r.name === name);
    emit('warn', route?.message ?? 'widget read failed', {
      error_code: route?.code ?? 'snapshot_unreadable',
      detail: part,
    });
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
