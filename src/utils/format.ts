/**
 * Tiny formatting helpers shared across the app.
 *
 * Keep this file for utilities that are NOT date/number/currency
 * specific (those have dedicated files). Add new helpers as
 * inline-avoidance — every i18n-sensitive snippet has a right to
 * live in one place.
 */

/**
 * Pick the singular or plural form based on count. Centralises the
 * previously-inline `count === 1 ? 'dose' : 'doses'` pattern so that
 * future locale-specific rules (zero-form, dual-form, etc.) have a
 * single implementation point.
 *
 * For English + beanie the rule is "one is singular; everything else
 * is plural." Negative counts follow the same rule (not expected in
 * practice, but defined behavior > undefined behavior).
 *
 * @example pluralize(1, 'dose', 'doses')   // "dose"
 * @example pluralize(3, 'dose', 'doses')   // "doses"
 * @example pluralize(0, 'dose', 'doses')   // "doses"
 */
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}
