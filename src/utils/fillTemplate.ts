/**
 * Interpolate `{token}` placeholders in a template string with literal values.
 *
 * Why this exists: `someString.replace('{token}', value)` with a STRING replacement
 * interprets `$`-sequences in `value` (`$&`, `` $` ``, `$'`, `$$`, `$1`) as special
 * replacement patterns — so any user/account/family-controlled value containing a
 * `$` gets garbled (e.g. a family named `Smith $& Co` renders the matched text back
 * in its place). Using a FUNCTION replacer inserts the value literally, closing that
 * whole class of bug. Always interpolate externally-influenced text through this.
 *
 * - Replaces every occurrence of each `{key}` (not just the first).
 * - Nullish values render as `''`.
 * - Unmatched placeholders are left untouched.
 *
 * @example fillTemplate(t('join.verifyInvited'), { family: familyName })
 */
export function fillTemplate(template: string, vars: Record<string, unknown>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const literal = String(value ?? '');
    // Function replacer → the value is inserted literally, never as a `$`-pattern.
    out = out.replaceAll(`{${key}}`, () => literal);
  }
  return out;
}
