/**
 * Splits a translated string around a single accent word so a call site can
 * apply different styling (e.g. a brand gradient) to that word without putting
 * HTML or markup into the i18n value.
 *
 * Used by WelcomeGate ("where would you like to begin?" / accent="begin") and
 * LoginBackground ("every bean counts" / accent="bean") to render a gradient
 * highlight on a single meaningful word without committing the i18n layer to
 * embedded HTML.
 *
 * Case-insensitive match. If the accent word is empty or not present in the
 * text (e.g. a translator drops or rewords it), returns the whole string as
 * `lead` with empty `accent` and `trail` — the caller renders the text
 * verbatim with no highlight. Graceful degradation by design.
 */
export interface AccentSplit {
  lead: string;
  accent: string;
  trail: string;
}

export function splitAroundAccent(text: string, accent: string): AccentSplit {
  if (!accent) return { lead: text, accent: '', trail: '' };
  const idx = text.toLowerCase().indexOf(accent.toLowerCase());
  if (idx === -1) return { lead: text, accent: '', trail: '' };
  return {
    lead: text.slice(0, idx),
    accent: text.slice(idx, idx + accent.length),
    trail: text.slice(idx + accent.length),
  };
}
