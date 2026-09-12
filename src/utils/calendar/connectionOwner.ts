/**
 * Who should be asked to repair a dead Google Calendar connection, and who should
 * merely be told about it.
 *
 * ## The defect this exists to fix
 *
 * `needs_reconnect` lives in the family-wide CRDT, so one revoked grant is true on
 * EVERY member's device at once. The app showed all of them the same actionable,
 * non-dismissable prompt — including the members who have no idea what the Google
 * account's password is. On a phone that prompt sits over the bottom navigation,
 * so a problem they cannot solve permanently blocks the app.
 *
 * ## Why this is a pure module
 *
 * Two of the decisions below are the kind that must be provable rather than
 * argued about:
 *
 *  1. **The Drive guarantee.** A Drive outage is a data-at-risk warning and must
 *     reach everyone, always. Because dismissals are keyed on CALENDAR connection
 *     ids, a member who dismissed the calendar notice and then loses Drive would
 *     otherwise be silently filtered out of the `'both'` prompt. That early return
 *     is the first rule in `decideOutageAudience`, in a pure function, so it can be
 *     table-tested and mutation-checked — not buried in a template expression.
 *
 *  2. **The ownership ladder**, which has four rungs and several ways to name the
 *     wrong person (a removed member, a pet with a placeholder email, the
 *     `'unknown'` sentinel).
 *
 * Neither reads a store, a translator, or `localStorage`. `useCalendarOutageAudience`
 * does that and nothing else.
 *
 * ⚠️ **"Owner" here is INFERRED, not verified.** Nothing in the reconnect path
 * checks which Google account actually consented: `calendarSyncStore` passes the
 * connection's `accountEmail` only as a `loginHint`, and `finalizeConnected`
 * overwrites `accountEmail` + `refreshToken` with whatever account the user picked.
 * Do not read a `member` verdict as an authorization decision — it decides who is
 * SHOWN a button that is already reachable by every member from Settings.
 *
 * Not to be confused with `linkOwnership.ts`, which answers a different ownership
 * question entirely: who owns a linked calendar EVENT.
 */
import type { FamilyMember, UUID } from '@/types/models';
import { isTemporaryEmail, sameAccount } from '@/utils/email';

/**
 * The coordinator's calendar down-descriptor, plus the new provenance field.
 *
 * ONE shape end to end: `useReconnectCoordinator` builds it, the composable passes
 * it straight through, and these functions consume it. No adapter `.map()` anywhere
 * — a third shape for the same fact is exactly the drift this module avoids.
 */
export interface CalendarDownDescriptor {
  connectionId: string;
  /**
   * `CalendarConnection.accountEmail` — a required string, so never null. The
   * literal `'unknown'` is the sentinel written when consent returned no address;
   * it must never match a member and never reach rendered copy.
   */
  email: string;
  connectedBy?: UUID;
}

/** The `'unknown'` literal `calendarSyncStore` writes when consent returns no email. */
const UNKNOWN_ACCOUNT = 'unknown';

/** Only the member fields the ladder reads — keeps the functions trivially callable from a test. */
export type OwnerCandidate = Pick<FamilyMember, 'id' | 'email' | 'googleAccountEmail'>;

/**
 * Who owns this connection.
 *
 * `via` is carried for telemetry, not for display: it is what turns "she still
 * can't dismiss it" into a diagnosable CloudWatch filter without a repro.
 */
export type OwnerVerdict =
  | { kind: 'member'; memberId: UUID; via: 'connected-by' | 'google-email' | 'contact-email' }
  /** Nobody matched. `accountEmail` is null when it was the `'unknown'` sentinel. */
  | { kind: 'managers'; accountEmail: string | null };

/** What this viewer should be shown for the current outage. */
export type OutageAudience =
  | { mode: 'owner' }
  /** Carries the verdict as DATA — the component picks the string and interpolates it. */
  | { mode: 'notice'; owner: OwnerVerdict }
  /**
   * `reason` exists so a disappearance is never silent. `dismissed` and
   * `nothing-down` are ordinary; `roster` means we declined to decide because the
   * family list was empty, and if that ever coincides with a real outage the owner
   * sees nothing at all — so the composable reports that one.
   */
  | { mode: 'hidden'; reason: 'roster' | 'nothing-down' | 'dismissed' };

/** A usable account email, or null for the sentinel. */
function realAccountEmail(email: string): string | null {
  return email && email !== UNKNOWN_ACCOUNT ? email : null;
}

/**
 * Can this member's stored address be matched against a Google account at all?
 *
 * `FamilyMember.email` is a REQUIRED string that the app fills with generated
 * placeholders (`pending-*@setup.local`, `*@temp.beanies.family`) for members
 * without a real address — pets, and anyone added without one. A bare non-empty
 * check would therefore let two placeholder-only members both "match" a
 * connection. `isTemporaryEmail` covers both patterns.
 */
function matchable(email: string | undefined): string | null {
  return email && !isTemporaryEmail(email) ? email : null;
}

/**
 * Resolve the owner of one down connection.
 *
 * The ladder, in order, so existing connections work with no migration:
 *
 *  1. `connectedBy` — the only rung that is KNOWN rather than inferred. Wins only
 *     if the id still resolves to a live member: a member who has since left the
 *     pod would otherwise render as "Ask Unknown to reconnect it", which is worse
 *     than naming a manager.
 *  2. `googleAccountEmail` — the OAuth-bound identity, which is what a Google
 *     connection's `accountEmail` actually IS.
 *  3. `email` — the user-editable contact address, documented on the model as "not
 *     required to match any specific external account". It is a weaker signal than
 *     rung 2 by construction, so it comes second.
 *  4. Pod managers — the catch-all, so a connection made with an unmatched personal
 *     Gmail still reaches somebody who can act.
 */
export function resolveConnectionOwner(
  connection: CalendarDownDescriptor,
  members: readonly OwnerCandidate[]
): OwnerVerdict {
  const { connectedBy, email } = connection;

  if (connectedBy && members.some((m) => m.id === connectedBy)) {
    return { kind: 'member', memberId: connectedBy, via: 'connected-by' };
  }

  const account = realAccountEmail(email);
  if (account) {
    const byGoogle = members.find((m) => sameAccount(matchable(m.googleAccountEmail), account));
    if (byGoogle) return { kind: 'member', memberId: byGoogle.id, via: 'google-email' };

    const byContact = members.find((m) => sameAccount(matchable(m.email), account));
    if (byContact) return { kind: 'member', memberId: byContact.id, via: 'contact-email' };
  }

  return { kind: 'managers', accountEmail: account };
}

export interface OutageAudienceInput {
  /**
   * The coordinator's own prompt variant.
   *
   * ⚠️ NON-`'calendar'` variants ALWAYS return `{ mode: 'owner' }`. Drive is a
   * data-at-risk warning and reaches everyone; a dismissed CALENDAR notice can
   * never suppress it. This is the whole Drive guarantee and it is the first rule
   * below, ahead of the roster gate and the dismissal check.
   */
  variant: 'drive' | 'calendar' | 'both';
  downConnections: readonly CalendarDownDescriptor[];
  members: readonly OwnerCandidate[];
  viewerId: string | null;
  viewerCanManagePod: boolean;
  /** Connection ids this viewer has already dismissed a notice for, on this device. */
  dismissedIds: readonly string[];
}

/**
 * Decide what this viewer sees. Pure; every branch is table-testable.
 */
export function decideOutageAudience(input: OutageAudienceInput): OutageAudience {
  const { variant, downConnections, members, viewerId, viewerCanManagePod, dismissedIds } = input;

  // 1. The Drive guarantee. Nothing below can suppress a Drive or Drive+calendar
  //    prompt — not a dismissal, not an empty roster, not a failed resolution.
  if (variant !== 'calendar') return { mode: 'owner' };

  // 2. An owner cannot be resolved against an empty roster, and `canManagePod`
  //    falls back to the session role while it is empty, so deciding here would
  //    flash the wrong prompt during a cold load.
  //
  //    In practice this coincides with "nothing is down": `connections` and
  //    `members` project from the same Automerge doc and a family always has at
  //    least one member, so an empty roster means an unloaded doc, which means
  //    `variant` was already null. It is reported anyway (see `reason`) because
  //    the one way it could matter is a case nobody would otherwise see.
  if (members.length === 0) return { mode: 'hidden', reason: 'roster' };
  if (downConnections.length === 0) return { mode: 'hidden', reason: 'nothing-down' };

  const verdicts = downConnections.map((c) => ({ c, verdict: resolveConnectionOwner(c, members) }));

  // 3. Deliberately SOME, not every: a viewer who owns one of two down connections
  //    still gets the actionable prompt, because the button already reconnects
  //    everything it can. Handing that person a notice with somebody else's name on
  //    it would be this plan's own failure, inverted.
  //
  //    ⚠️ `viewerCanManagePod` is consulted ONLY on the `managers` rung, and that
  //    asymmetry is intentional — a code review flagged it as a bug, and it is not.
  //    Managing the pod does not mean holding the Google account's password, and
  //    the reconnect consent is account-bound: a manager who is not on that account
  //    cannot complete it, so offering them the button would be a dead end dressed
  //    up as a fix. greg's instruction is explicit that the person who set the
  //    integration up is the one who should repair it.
  //
  //    The stuck-family case is already covered by the ladder rather than here: a
  //    `connectedBy` pointing at a departed member falls through, their emails no
  //    longer match anybody, and the connection lands on rung 4 — where managers DO
  //    get the button. So a family whose calendar-connector leaves is never stranded.
  const viewerOwnsAny = verdicts.some(({ verdict }) =>
    verdict.kind === 'member' ? verdict.memberId === viewerId : viewerCanManagePod
  );
  if (viewerOwnsAny) return { mode: 'owner' };

  // 4. Dismissal is per connection id, so a NEWLY broken connection speaks up
  //    again while a healed one simply stops being asked about.
  const undismissed = verdicts.filter(({ c }) => !dismissedIds.includes(c.connectionId));
  if (undismissed.length === 0) return { mode: 'hidden', reason: 'dismissed' };

  return { mode: 'notice', owner: undismissed[0]!.verdict };
}
