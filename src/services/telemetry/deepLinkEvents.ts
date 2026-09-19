/**
 * Typed telemetry facade for the `deep-link` surface.
 *
 * One narrow function per event name, wrapping `logEvent`, following the rule stated on
 * `loginFlowEvents.ts`: no view or service calls `logEvent` with a hand-typed event
 * string for this surface, because a payload shape that drifts per call site makes the
 * metric untrustworthy.
 *
 * ⚠️ WHY THIS SURFACE EXISTS AT ALL. Until 0.21.3 the only signal an inbound approval
 * link produced was the bridge's `inbound_link_routed` on the `login-flow` surface —
 * which fired on the BROKEN path too, because routing the link was never the step that
 * failed. CloudWatch therefore reported success for a feature that did not work for a
 * single native user. The events below measure DELIVERY, not routing, which is the thing
 * that was actually broken.
 *
 * Context discipline: every field rides on already-allowlisted context keys (`action`,
 * `kind`, `error_code`, `route_path` — see ALLOWED_CONTEXT_KEYS in diagnosticContext.ts),
 * so no store-declaration change ships with this surface. The approval key itself is a
 * credential-shaped value and is NEVER logged, not even truncated.
 *
 * ⚠️ NOT exported from `services/telemetry/index.ts`. That barrel is mocked as
 * `{ logEvent }` by a dozen test files, and adding exports to it breaks them.
 */

import { logEvent, type LogLevel } from '@/services/telemetry/logEvent';

const SURFACE = 'deep-link';

/**
 * How the link reached us. This is the variable that produced the 0.21.3 defect: warm
 * delivery failed because the route did not change, cold delivery failed because the
 * launch URL resolved after the one-shot read. Splitting them is what lets one of the two
 * be seen working while the other is not.
 */
export type DeliveryKind = 'warm' | 'cold-launch' | 'web-load' | 'in-app-scan';

/**
 * ⚠️ `kind` CARRIES ONE VOCABULARY ON THIS SURFACE — the `DeliveryKind` values above, and
 * nothing else. An earlier version also mapped marker constants ('approve' / 'kit') onto
 * the same field, which meant an alert grouping on `kind` silently mixed transport buckets
 * with marker buckets, and a filter written from the type excluded every web event.
 *
 * `in-app-scan` belongs in that vocabulary rather than in a second field: it IS how the key
 * arrived, and it is also the thing the approval interstitial keys on. Keeping provenance on
 * the same value as the transport is what makes it impossible for a buffered deep-link key
 * to be released while a parallel flag claims it was scanned in-app.
 */
function emit(level: LogLevel, message: string, context: Record<string, unknown>): void {
  logEvent({ level, surface: SURFACE, message, context });
}

/**
 * An approval key reached its consumer. THE SUCCESS-PATH EVENT.
 *
 * Emitted on success deliberately, not only on failure: without it there is no
 * denominator, and "no errors" reads identically to "no deliveries at all" — which is
 * exactly how the 0.21.3 breakage stayed invisible.
 */
export function emitApprovalKeyDelivered(payload: { delivery: DeliveryKind }): void {
  emit('info', 'approval_key_delivered', {
    action: 'approval_key_delivered',
    kind: payload.delivery,
  });
}

/**
 * A key arrived but cannot be shown yet, so it is being held.
 *
 * THE ARRIVAL DENOMINATOR. Without it, a native scan on a device whose pod is still opening
 * emits nothing at all on this surface, so "no drops" and "no arrivals" look identical —
 * which is the shape of the blind spot this whole surface exists to close.
 */
export function emitApprovalKeyHeld(payload: { delivery: DeliveryKind }): void {
  emit('info', 'approval_key_held', {
    action: 'approval_key_held',
    kind: payload.delivery,
  });
}

/**
 * The URL passed the allowlist and carried an approval marker, but delivery failed.
 *
 * `warn`, not `critical`: the person is looking at a device that visibly did nothing and
 * can re-scan, so this does not warrant paging Slack. It does warrant an alert on the
 * rate.
 */
export function emitApprovalKeyDropped(payload: {
  delivery: DeliveryKind;
  errorCode: string;
}): void {
  emit('warn', 'approval_key_dropped', {
    action: 'approval_key_dropped',
    kind: payload.delivery,
    error_code: payload.errorCode,
  });
}

/**
 * A marker captured at boot was consumed by the web one-shot read.
 *
 * `routePath` MUST come from `window.location.pathname` and never from `fullPath` or
 * `href`. `fullPath` is path + query + HASH, and on this path the hash IS the key — see
 * the incident recorded in docs/lessons.md where exactly that leaked private content into
 * this allowlisted field.
 *
 * Only the approval marker is ever consumed this way; the recovery kit is read by
 * LoginPage off `window.location.hash` and never reaches the capture map.
 */
export function emitMarkerConsumed(payload: { routePath: string }): void {
  emit('info', 'marker_consumed', {
    action: 'marker_consumed',
    kind: 'web-load',
    route_path: payload.routePath,
  });
}
