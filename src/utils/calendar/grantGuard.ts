// The one revoke guard for calendar grants (view-only calendars plan 2026-11-17).
//
// Google's token revoke is WHOLE-GRANT for a (user, client id) pair. Drive, every
// calendar sync connection and every view-only account share one client id, so
// revoking any one refresh token for a Google account also kills every other token
// that account holds with beanies: the live Drive session, a sibling sync
// connection, a view account. Revoking is therefore only safe when nothing else
// uses the same account.
//
// Pure on purpose: the callers (the sync store today, the view store later) pass in
// what they know, so neither store has to import the other to ask.

/** Anything that holds a calendar credential for a Google account. */
export interface GrantHolder {
  id: string;
  accountEmail?: string | null;
}

export interface GrantGuardInput {
  /** The account of the token about to be revoked. */
  email: string | null | undefined;
  /** The holder being removed or replaced; it never counts as sharing with itself. */
  exceptId?: string;
  /** The signed-in Drive account on this device, when known. */
  driveEmail: string | null | undefined;
  /** Every calendar sync connection. */
  connections: readonly GrantHolder[];
  /** Every view-only calendar account. */
  viewAccounts: readonly GrantHolder[];
}

/** A real, comparable email (lowercased): not missing and not the `'unknown'` sentinel. */
export function knownEmail(email: string | null | undefined): string | null {
  if (!email || email === 'unknown') return null;
  return email.toLowerCase();
}

/** Do both name the same real Google account? Unknown or missing on either side is `false`. */
export function isSameKnownAccount(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const x = knownEmail(a);
  return x !== null && x === knownEmail(b);
}

/**
 * Are these two POSITIVELY different Google accounts?
 *
 * Fail-safe, deliberately asymmetric: `true` only when both sides name a real,
 * different account. An `'unknown'` sentinel or a missing email on either side
 * returns `false` ("cannot confirm a mismatch"), because refusing on uncertainty
 * would brick a credential that is otherwise repairable. Used by both stores'
 * reconnects so a re-consent can never repoint a record at another account.
 */
export function isPositivelyDifferentAccount(
  stored: string | null | undefined,
  consented: string | null | undefined
): boolean {
  const x = knownEmail(stored);
  const y = knownEmail(consented);
  return x !== null && y !== null && x !== y;
}

/**
 * Would revoking this token take something else down with it?
 *
 * FAIL SAFE: `true` (do not revoke) on every uncertainty. An unknown or missing
 * email on the token itself, an unknown Drive account, or another holder whose
 * email is unknown all count as shared. The cost of a wrong `true` is one leaked
 * token that ages out on its own; the cost of a wrong `false` is a family whose
 * Drive and calendars all stop working on every device.
 *
 * The Drive rule keeps today's behaviour exactly: with no known Drive account on
 * this device the answer is `true`, because a sibling device may hold a live Drive
 * grant for this account (the 2026-09-08 fleet-wide ping-pong).
 */
export function anotherGrantSharesAccount(input: GrantGuardInput): boolean {
  const email = knownEmail(input.email);
  if (!email) return true;

  const drive = knownEmail(input.driveEmail);
  if (!drive || drive === email) return true;

  const sharesWith = (holder: GrantHolder): boolean => {
    if (holder.id === input.exceptId) return false;
    const other = knownEmail(holder.accountEmail);
    return other === null || other === email;
  };
  return input.connections.some(sharesWith) || input.viewAccounts.some(sharesWith);
}
