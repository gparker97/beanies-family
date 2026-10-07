/**
 * The ONE definition of what separates words in a passphrase (#81). Used by the strength
 * rules, the EFF fallback and the per-word scorer so they can never tokenise differently.
 */
export const PASSPHRASE_SEPARATORS = /[\s\-_.]+/;

/** Lowercased words, separators dropped, empties removed. */
export function splitPassphraseWords(phrase: string): string[] {
  return phrase.trim().toLowerCase().split(PASSPHRASE_SEPARATORS).filter(Boolean);
}

/** The phrase with every separator removed, lowercased: the name-equality form. */
export function canonPassphrase(value: string): string {
  return value.toLowerCase().replace(new RegExp(PASSPHRASE_SEPARATORS.source, 'g'), '');
}
