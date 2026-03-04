/**
 * Check if an email is a temporary placeholder.
 * Patterns: `pending-*@setup.local` (pod creation) and `*@temp.beanies.family` (member modal).
 */
export function isTemporaryEmail(email: string): boolean {
  return email.endsWith('@setup.local') || email.endsWith('@temp.beanies.family');
}
