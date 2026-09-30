/**
 * The UI language as a BCP-47 locale, for `Intl` date formatting that must follow the
 * app's language rather than the browser's (a shared picture or a list title should not be
 * half-translated). English is American: month before day ("Sep 28").
 */
import type { LanguageCode } from '@/types/models';

export const UI_LOCALE: Readonly<Record<LanguageCode, string>> = Object.freeze({
  en: 'en-US',
  zh: 'zh-CN',
});

/** The locale for a UI language, falling back to American English. */
export function uiLocale(lang: LanguageCode | undefined): string {
  return (lang && UI_LOCALE[lang]) || UI_LOCALE.en;
}

/** A local calendar date ("2026-09-28") formatted in the UI language. */
export function formatUiDate(
  dateISO: string,
  lang: LanguageCode | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(uiLocale(lang), options).format(new Date(`${dateISO}T00:00:00`));
}
