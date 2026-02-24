/**
 * Check if an email is a temporary placeholder generated during family setup.
 * These have the pattern `pending-*@setup.local`.
 */
export function isTemporaryEmail(email: string): boolean {
  return email.endsWith('@setup.local');
}
