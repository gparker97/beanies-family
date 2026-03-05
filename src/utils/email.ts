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
