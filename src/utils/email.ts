/**
 * Check if an email is a temporary placeholder.
 * Patterns: `pending-*@setup.local` (pod creation) and `*@temp.beanies.family` (member modal).
 */
export function isTemporaryEmail(email: string): boolean {
  return email.endsWith('@setup.local') || email.endsWith('@temp.beanies.family');
}

/**
 * Basic email validation (RFC-ish, covers real-world addresses).
 */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * True for emails that can never succeed as a Drive permission grantee:
 *   - Temporary placeholders the app generates for members without a real email
 *     (`pending-*@setup.local`, `*@temp.beanies.family`).
 *   - RFC 2606 reserved TLDs (`.local`, `.test`, `.invalid`, `.example`) and
 *     the `example.com` / `example.org` sentinel domains.
 *
 * Drive responds 403 "not a Google account" for all of these — each attempt is
 * a wasted round-trip and a noisy console error. Filter pre-flight to skip them.
 *
 * Real-looking emails still hit Drive (Drive remains the source of truth for
 * whether the target Google account actually exists).
 */
export function isUnshareableEmail(email: string): boolean {
  if (isTemporaryEmail(email)) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return (
    domain.endsWith('.local') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.example') ||
    domain === 'example.com' ||
    domain === 'example.org'
  );
}

/**
 * Do these two strings name the same Google account?
 *
 * Google account emails are case-insensitive, so compare case-folded: a stored
 * connection email that differs only in case still matches the live session.
 * Null/undefined/empty on either side is never a match — in particular the
 * `'unknown'` sentinel `calendarSyncStore` writes when consent returns no
 * address must never be matched against anything, so callers pass it through
 * this helper rather than comparing by hand.
 *
 * Lives here rather than beside either caller because it is an EMAIL question,
 * not a reconnect or an ownership one. Both `useReconnectCoordinator` (grouping
 * down features by account) and `connectionOwner` (resolving who owns a
 * connection) import it.
 */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * The address worth storing as somebody's contact email, or `null`.
 *
 * Trims, then rejects anything `isValidEmail` would and the placeholders the app
 * invents for members with no address yet (`isTemporaryEmail`). Used where an
 * address leaves the device as a contact record (the registry's `ownerEmail`),
 * so a placeholder can never be latched as the owner's mailbox.
 *
 * ⚠️ TWIN: the registry Lambda's `realEmail` in
 * `infrastructure/lambda/registry/owner.mjs` applies the same rule server-side
 * (it cannot import this file). `attributionTwinDrift.test.ts` runs one shared
 * table through both; change them together.
 */
export function realEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  // Case-folded for the placeholder test only (domains are case-insensitive, and the Lambda
  // twin folds too); the address itself is returned with its case intact.
  if (!isValidEmail(trimmed) || isTemporaryEmail(trimmed.toLowerCase())) return null;
  return trimmed;
}
