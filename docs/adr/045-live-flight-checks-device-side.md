# ADR-045: Live flight checks run on the device through an anonymous proxy

- **Status:** Accepted
- **Date:** 2026-11-07
- **Related:** ADR-011, ADR-029, ADR-030, ADR-043; tracker #143
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-11-07-travel-live-flight-checks.md`
- **Implementation:** (pending)

## Context

A family types a flight into a trip once and then trusts it. Airlines move times and terminals and cancel flights, and beanies never finds out: a trip segment keeps the booking's wall-clock time until the trip is over. Live flight status needs a third-party provider with a secret key, so the key cannot ship in the client, and the app is local-first with no server that sees family content (ADR-011, ADR-029). Unlike weather (ADR-043), the provider is paid, has no browser CORS story and bills per call, so a direct device call is not an option and an unguarded proxy is a spend risk.

## Decision

1. **Provider: AeroDataBox, behind an adapter in the Lambda.** The Lambda owns the provider: `providers/aerodatabox.mjs` maps the vendor response to a small beanies `FlightLeg` shape, and the client never sees vendor fields. A provider swap is a Lambda change plus terraform variables. AeroDataBox is reachable through three channel modes (the direct plan, and marketplace channels); the direct Starter plan is the choice for now, and the channel is configuration inside the adapter.
2. **The proxy is anonymous.** The request carries a flight number and a date only: no family id, no member, no booking. This keeps the privacy sentence in Settings literally true and leaves the zero-knowledge posture (ADR-011, ADR-029) untouched. The Lambda is bounded in layers: a soft `x-api-key` (the content-fetch way), a route throttle, reserved concurrency, a per-IP hourly limit, a result cache, and a global daily provider-call cap. The cap is the only control that bounds spend. The Starter plan is 40,000 units a month with no overage, and a check costs 2 units, so at the route throttle's 5 requests a second an attacker rotating IPs and flight and date keys would exhaust the month in about 67 minutes, and every family would lose live checks until the next cycle. With the cap, the worst case is one day's budget and a cache-only Lambda until UTC midnight. Cache hits are still served after the cap is reached.
3. **Checks run on the device.** A store drives them on app open, foreground, coming back online, and a visible-poll tick, only inside a window from 72 hours before scheduled departure to 2 hours after scheduled arrival. Per-flight minimum intervals (6 hours beyond a day out, 30 minutes inside a day, 10 minutes inside 3 hours) decide whether a tick fetches anything. Failures back off on the same ladder as weather. A flight past the window is never checked and its cache entry is dropped.
4. **Schedule changes and cancellations auto-apply to the pod.** The device writes the new values through `vacationStore.updateSegment`, three-way reconciled per ADR-039. Idempotency across devices comes from `liveRevision`, the canonical tuple string of the provider's scheduled values (departure date, time and terminal, arrival date and time). A device writes only when the provider's tuple differs from `liveRevision`, so two devices that see the same change make one write, and a race converges because the values written are computed from the same base. The segment also stores `liveWas` (the prior values, for the struck-out display and "Put it back"), `liveAppliedAt` and `liveCancelledAt`. A manual edit wins until the airline changes again: when the revision matches but the segment differs from the provider, nothing is written and the card shows Conflict, with "Use the airline's" to take the provider value. Estimates, gate and baggage belt are display-only and live in a per-device localStorage cache, never in the pod. Only the provider's firm `Canceled` status flips a segment to pending; uncertain and diverted statuses are display-only.
5. **Entitlement is enforced on the client.** Checks are a magic beans feature, on during the free trial. A family is entitled when its entitlement is `trial`, `beta`, or `active` on the full plan, and an answer that is not enforced (the dry-run period) counts as entitled. An unentitled device makes no request at all. The Lambda cannot enforce entitlement without a family id, which decision 2 rules out.
6. **The AI residue matcher is conditional.** Deterministic matching (carrier and number, then the leg whose airports match the booking) is built first. A sealed AI arm for the unresolved residue is built only if Spike 0 shows real bookings that the deterministic matcher cannot settle. If it is built, the privacy copy changes: the sealed reader then receives the booking's route and time, and the sealed path carries the family id, so "only the flight number and date" would no longer be literally true for those flights. The Settings sentence, the Help article and this ADR must then say so.
7. **Phase 2 server push is deferred.** An anonymous server subscription that pushes changes while the app is closed is a separate, later plan. Phase 1 only knows what the device learns when it is open.

## Consequences

- AeroDataBox sees the flight number and date of each uncached check, plus the proxy's IP, never a family.
- A device that is closed all day learns nothing; the OS reminder still fires, and the change is picked up the next time the app opens.
- The pod gains four optional fields on a travel segment; the cache and the display-only live values stay per device and are cleared on sign-out.
- A global cap means a coordinated abuse can switch off fresh checks for everyone for the rest of a UTC day. The alarms on the cap, provider auth and provider rate limits page `#beanies-errors`.
- Three new diagnostic context keys (`flight_state`, `flight_match`, `flight_fields`) join the allowlist and the store declarations.

## Revisit when

- Phase 2 push is planned, which needs an identity the proxy deliberately lacks.
- A provider with webhooks or a push feed becomes available.
- Per-family metering is needed, for example if one family or a small set of families drives most of the daily cap.
- A cheaper marketplace channel for the same provider is available.
- The AI residue rate (unmatched flights with `flight_match: 'none'`) is high enough to justify, or to retire, the sealed arm.

## Alternatives considered

- **Per-family auth on the proxy.** Rejected: content-fetch's rule is not to invent per-family auth, and sending a family id would break the privacy sentence.
- **A hash for `liveRevision`.** Rejected: a persisted id is a data format, and the canonical tuple is readable in the pod and needs no async crypto.
- **Confirm-before-apply UI.** Rejected by greg on 2026-11-07: changes apply, everyone is told, and "Put it back" undoes it.
- **FlightByte as the primary provider.** Rejected: weeks old, an undisclosed data source and no SLA. It is run beside AeroDataBox in Spike 0 for comparison only.
