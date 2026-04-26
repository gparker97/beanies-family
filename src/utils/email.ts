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
