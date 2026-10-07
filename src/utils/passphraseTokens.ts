/**
 * The ONE definition of what separates words in a passphrase (#81). Used by the strength
 * rules, the EFF fallback and the per-word scorer so they can never tokenise differently.
 */
export const PASSPHRASE_SEPARATORS = /[\s\-_.]+/;

/** Lowercased words, separators dropped, empties removed. */
export function splitPassphraseWords(phrase: string): string[] {
  return phrase.trim().toLowerCase().split(PASSPHRASE_SEPARATORS).filter(Boolean);
}

/**
 * The phrase with every separator removed, lowercased: the name-equality form. Split + join
 * rather than a global `replace`, so the one separator pattern above is reused as-is and no
 * RegExp is built from a string (the SAST gate rejects a non-literal RegExp constructor).
 */
export function canonPassphrase(value: string): string {
  return value.toLowerCase().split(PASSPHRASE_SEPARATORS).join('');
}
