import { useTranslationStore } from '@/stores/translationStore';

/** Translate a key with an English fallback (Pinia may be pre-init in edge flows).
 *
 * Lives in translation/ as a dependency-free leaf so foundational modules
 * (docClient, biometricShared, …) can localize user-facing strings without
 * importing an unrelated feature module. Keys are still defined in
 * `uiStrings.ts`; the cast keeps this helper key-agnostic (and pre-Pinia safe
 * via the catch). */
export function tr(key: string, fallback: string): string {
  try {
    const s = (useTranslationStore().t as (k: string) => string)(key);
    return s && s !== key ? s : fallback;
  } catch {
    return fallback;
  }
}
