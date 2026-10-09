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

/** One run of a template: literal text, or a filled-in `{token}` value. */
export interface TemplatePart {
  text: string;
  value: boolean;
}

/**
 * `fillTemplate`, split into runs so a view can style the filled-in values apart from the
 * words around them (a handwritten line keeps its numbers in a legible face). Joining the
 * parts' text gives exactly what `fillTemplate` returns; empty runs are dropped.
 *
 * @example splitTemplate('{count} things on today', { count: 3 })
 *   // [{ text: '3', value: true }, { text: ' things on today', value: false }]
 */
export function splitTemplate(template: string, vars: Record<string, unknown>): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const pattern = /\{(\w+)\}/g;
  let last = 0;
  for (const match of template.matchAll(pattern)) {
    const key = match[1]!;
    if (!Object.hasOwn(vars, key)) continue;
    if (match.index > last) parts.push({ text: template.slice(last, match.index), value: false });
    parts.push({ text: String(vars[key] ?? ''), value: true });
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last), value: false });
  return parts.filter((part) => part.text);
}
