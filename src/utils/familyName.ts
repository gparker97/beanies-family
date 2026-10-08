import { fillTemplate } from '@/utils/fillTemplate';

/**
 * The default family name suggested on the create wizard's step 1 (#128): "The Parker
 * family" from "Greg Parker". A DISPLAY default only, never a write; whatever the field
 * shows when the person submits is what `signUp` receives.
 *
 * Takes the last whitespace-separated token of the trimmed name (the whole name when it
 * is one token), after stripping trailing punctuation from the name ("Greg Parker." →
 * "Parker"), and interpolates it into `template`, the already-resolved
 * `t('auth.familyNameDefault')` (`'The {name} family'` / `'{name}一家'`). Pure: the caller
 * resolves the translation so this stays free of the translation store.
 *
 * Returns `''` for an empty (or punctuation-only) name, so the field stays empty and the
 * step's own "fill all fields" validation applies.
 */
export function deriveFamilyName(name: string, template: string): string {
  const cleaned = name.trim().replace(/[\p{P}\s]+$/u, '');
  if (!cleaned) return '';
  const tokens = cleaned.split(/\s+/);
  const surname = tokens[tokens.length - 1] ?? cleaned;
  return fillTemplate(template, { name: surname });
}
